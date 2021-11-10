const express = require('express');
const router = express.Router();
const Mongoose = require('mongoose');

// Bring in Models & Helpers
const Order = require('../../models/order');
const Cart = require('../../models/cart');
const Product = require('../../models/product');
const auth = require('../../middleware/auth');
const role = require('../../middleware/role');
const mailgun = require('../../services/mailgun');
const store = require('../../helpers/store');

router.post('/paied', auth, async (req, res) => {
	console.log(req.body);
});

router.post('/paying', auth, async (req, res) => {
	const total = req.body.total;
	const cartId = req.body.cartId;
	console.log('cartId: ', cartId);
	try {
		const partnerCode = 'MOMO';
		const partnerName = 'Test';
		const accessKey = 'F8BBA842ECF85';
		const secretkey = 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
		// const requestId = partnerCode + new Date().getTime();
		const requestId = partnerCode + cartId + '-' + new Date().getTime();
		const orderId = requestId;
		const orderInfo = 'pay with MoMo';
		const redirectUrl = `http://localhost:5000/order/paid`;
		const ipnUrl = 'http://localhost:5000/order/paid';
		// const ipnUrl = redirectUrl = "https://webhook.site/454e7b77-f177-4ece-8236-ddf1c26ba7f8";
		const amount = total;
		const requestType = 'captureWallet';
		const extraData = ''; //pass empty value if your merchant does not have stores

		//before sign HMAC SHA256 with format
		//accessKey=$accessKey&amount=$amount&extraData=$extraData&ipnUrl=$ipnUrl&orderId=$orderId&orderInfo=$orderInfo&partnerCode=$partnerCode&redirectUrl=$redirectUrl&requestId=$requestId&requestType=$requestType
		const rawSignature =
			'accessKey=' +
			accessKey +
			'&amount=' +
			amount +
			'&extraData=' +
			extraData +
			'&ipnUrl=' +
			ipnUrl +
			'&orderId=' +
			orderId +
			'&orderInfo=' +
			orderInfo +
			'&partnerCode=' +
			partnerCode +
			'&redirectUrl=' +
			redirectUrl +
			'&requestId=' +
			requestId +
			'&requestType=' +
			requestType;
		'&partnerName=' + partnerName;
		//puts raw signature
		console.log('--------------------RAW SIGNATURE----------------');
		console.log(rawSignature);
		//signature
		const crypto = require('crypto');
		const signature = crypto.createHmac('sha256', secretkey).update(rawSignature).digest('hex');
		console.log('--------------------SIGNATURE----------------');
		console.log(signature);

		const requestBody = JSON.stringify({
			partnerCode: partnerCode,
			accessKey: accessKey,
			requestId: requestId,
			amount: amount,
			orderId: orderId,
			orderInfo: orderInfo,
			redirectUrl: redirectUrl,
			ipnUrl: ipnUrl,
			extraData: extraData,
			requestType: requestType,
			signature: signature,
			lang: 'vi',
		});

		//Create the HTTPS objects
		const https = require('https');
		const options = {
			hostname: 'test-payment.momo.vn',
			port: 443,
			path: '/v2/gateway/api/create',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(requestBody),
			},
		};
		//Send the request and get the response
		const req = https.request(options, (response) => {
			console.log(`Status: ${response.statusCode}`);
			console.log(`Headers: ${JSON.stringify(response.headers)}`);
			response.setEncoding('utf8');
			response.on('data', (body) => {
				const payUrlIndex = body.indexOf('"payUrl":"') + 10;
				const payUrlLastIndex = body.indexOf('","deeplink"');
				const payUrl = body.slice(payUrlIndex, payUrlLastIndex);
				res.status(200).json({
					success: true,
					message: payUrl,
				});
				// if (JSON.parse(body).payUrl) {
				// 	console.log('payUrl: ');
				// 	console.log(JSON.parse(body)?.payUrl);
				// 	res.status(200).json({
				// 		success: true,
				// 		message: JSON.parse(body)?.payUrl,
				// 	});
				// }
			});
			response.on('end', () => {
				console.log('No more data in responseponse.');
			});
		});

		req.on('error', (e) => {
			console.log(`problem with request: ${e.message}`);
		});
		// write data to request body
		console.log('Sending....');
		req.write(requestBody);
		req.end();
	} catch (e) {
		console.log(e);
	}
});

router.post('/add', auth, async (req, res) => {
	try {
		const cart = req.body.cartId;
		const total = req.body.total;
		const user = req.user._id;
		const order = new Order({
			cart,
			user,
			total,
		});
		const orderDoc = await order.save();
		const cartDoc = await Cart.findById(orderDoc.cart._id).populate({
			path: 'products.product',
			populate: {
				path: 'brand',
			},
		});
		const newOrder = {
			_id: orderDoc._id,
			created: orderDoc.created,
			user: orderDoc.user,
			total: orderDoc.total,
			products: cartDoc.products,
		};
		await mailgun.sendEmail(order.user.email, 'order-confirmation', newOrder);
		res.status(200).json({
			success: true,
			message: `Your order has been placed successfully!`,
			order: { _id: orderDoc._id },
		});
	} catch (error) {
		res.status(400).json({
			error: 'Your request could not be processed. Please try again.',
		});
	}
});

// search orders api
router.get('/search', auth, async (req, res) => {
	try {
		const { search } = req.query;

		if (!Mongoose.Types.ObjectId.isValid(search)) {
			return res.status(200).json({
				orders: [],
			});
		}

		let ordersDoc = null;

		if (req.user.role === role.ROLES.Admin) {
			ordersDoc = await Order.find({
				_id: Mongoose.Types.ObjectId(search),
			}).populate({
				path: 'cart',
				populate: {
					path: 'products.product',
					populate: {
						path: 'brand',
					},
				},
			});
		} else {
			const user = req.user._id;
			ordersDoc = await Order.find({
				_id: Mongoose.Types.ObjectId(search),
				user,
			}).populate({
				path: 'cart',
				populate: {
					path: 'products.product',
					populate: {
						path: 'brand',
					},
				},
			});
		}

		ordersDoc = ordersDoc.filter((order) => order.cart);

		if (ordersDoc.length > 0) {
			const newOrders = ordersDoc.map((o) => {
				return {
					_id: o._id,
					total: parseFloat(Number(o.total.toFixed(2))),
					created: o.created,
					products: o.cart?.products,
				};
			});

			let orders = newOrders.map((o) => store.caculateTaxAmount(o));
			orders.sort((a, b) => b.created - a.created);
			res.status(200).json({
				orders,
			});
		} else {
			res.status(200).json({
				orders: [],
			});
		}
	} catch (error) {
		res.status(400).json({
			error: 'Your request could not be processed. Please try again.',
		});
	}
});

// fetch orders api
router.get('/', auth, async (req, res) => {
	try {
		const user = req.user._id;

		let ordersDoc = await Order.find({ user }).populate({
			path: 'cart',
			populate: {
				path: 'products.product',
				populate: {
					path: 'brand',
				},
			},
		});

		ordersDoc = ordersDoc.filter((order) => order.cart);

		if (ordersDoc.length > 0) {
			const newOrders = ordersDoc.map((o) => {
				return {
					_id: o._id,
					total: parseFloat(Number(o.total.toFixed(2))),
					created: o.created,
					products: o.cart?.products,
				};
			});

			let orders = newOrders.map((o) => store.caculateTaxAmount(o));
			orders.sort((a, b) => b.created - a.created);
			res.status(200).json({
				orders,
			});
		} else {
			res.status(200).json({
				orders: [],
			});
		}
	} catch (error) {
		res.status(400).json({
			error: 'Your request could not be processed. Please try again.',
		});
	}
});

// fetch order api
router.get('/:orderId', auth, async (req, res) => {
	try {
		const orderId = req.params.orderId;

		let orderDoc = null;

		if (req.user.role === role.ROLES.Admin) {
			orderDoc = await Order.findOne({ _id: orderId }).populate({
				path: 'cart',
				populate: {
					path: 'products.product',
					populate: {
						path: 'brand',
					},
				},
			});
		} else {
			const user = req.user._id;
			orderDoc = await Order.findOne({ _id: orderId, user }).populate({
				path: 'cart',
				populate: {
					path: 'products.product',
					populate: {
						path: 'brand',
					},
				},
			});
		}

		if (!orderDoc || !orderDoc.cart) {
			return res.status(404).json({
				message: `Cannot find order with the id: ${orderId}.`,
			});
		}

		let order = {
			_id: orderDoc._id,
			total: orderDoc.total,
			created: orderDoc.created,
			totalTax: 0,
			products: orderDoc?.cart?.products,
			cartId: orderDoc.cart._id,
		};

		order = store.caculateTaxAmount(order);

		res.status(200).json({
			order,
		});
	} catch (error) {
		res.status(400).json({
			error: 'Your request could not be processed. Please try again.',
		});
	}
});

router.delete('/cancel/:orderId', auth, async (req, res) => {
	try {
		const orderId = req.params.orderId;

		const order = await Order.findOne({ _id: orderId });
		const foundCart = await Cart.findOne({ _id: order.cart });

		increaseQuantity(foundCart.products);

		await Order.deleteOne({ _id: orderId });
		await Cart.deleteOne({ _id: order.cart });

		res.status(200).json({
			success: true,
		});
	} catch (error) {
		res.status(400).json({
			error: 'Your request could not be processed. Please try again.',
		});
	}
});

router.put('/status/item/:itemId', auth, async (req, res) => {
	try {
		const itemId = req.params.itemId;
		const orderId = req.body.orderId;
		const cartId = req.body.cartId;
		const status = req.body.status || 'Cancelled';

		const foundCart = await Cart.findOne({ 'products._id': itemId });
		const foundCartProduct = foundCart.products.find((p) => p._id == itemId);

		await Cart.updateOne(
			{ 'products._id': itemId },
			{
				'products.$.status': status,
			}
		);

		if (status === 'Cancelled') {
			await Product.updateOne({ _id: foundCartProduct.product }, { $inc: { quantity: foundCartProduct.quantity } });

			const cart = await Cart.findOne({ _id: cartId });
			const items = cart.products.filter((item) => item.status === 'Cancelled');

			// All items are cancelled => Cancel order
			if (cart.products.length === items.length) {
				await Order.deleteOne({ _id: orderId });
				await Cart.deleteOne({ _id: cartId });

				return res.status(200).json({
					success: true,
					orderCancelled: true,
					message: `${req.user.role === role.ROLES.Admin ? 'Order' : 'Your order'} has been cancelled successfully`,
				});
			}

			return res.status(200).json({
				success: true,
				message: 'Item has been cancelled successfully!',
			});
		}

		res.status(200).json({
			success: true,
			message: 'Item status has been updated successfully!',
		});
	} catch (error) {
		res.status(400).json({
			error: 'Your request could not be processed. Please try again.',
		});
	}
});

const increaseQuantity = (products) => {
	let bulkOptions = products.map((item) => {
		return {
			updateOne: {
				filter: { _id: item.product },
				update: { $inc: { quantity: item.quantity } },
			},
		};
	});

	Product.bulkWrite(bulkOptions);
};

module.exports = router;
