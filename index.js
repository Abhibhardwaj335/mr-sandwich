const AWS = require("aws-sdk");
const axios = require("axios");

const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.CUSTOMER_TABLE;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

exports.handler = async (event) => {
  console.log("📥 Request received:", JSON.stringify(event));

  const method = event.httpMethod;
  const path = event.path;

  if (method === "POST" && path.includes("/login")) {
    const { username, password } = JSON.parse(event.body");
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      return response(200, { success: true });
    } else {
      return response(401, { success: false, message: "Invalid credentials" });
    }
  }

  if (method === "POST" && path.includes("/customer")) {
    const { name, phoneNumber, dob } = JSON.parse(event.body);

    if (!name || !phoneNumber || !dob) {
      return response(400, { message: "Missing fields" });
    }

    try {
      const customerId = phoneNumber.substring(3);
      const customerData = {
        PK: `CUSTOMER#${customerId}`,
        SK: "PROFILE",
        recordType: "customer",
        name,
        phoneNumber,
        dob,
        createdAt: new Date().toISOString(),
      };

      await dynamo.put({
        TableName: TABLE_NAME,
        Item: customerData,
      }).promise();

      console.log("✅ Customer saved:", customerData);
      return response(200, { message: "Customer saved", customerId });
    } catch (err) {
      console.error("🔥 Error saving customer:", err);
      return response(500, { message: "Error saving customer" });
    }
  }

  // GET /customer?id=
  if (method === "GET" && path.includes("/customer")) {
    const customerId = event.queryStringParameters?.id;

    if (!customerId) {
      return response(400, { message: "Missing customer ID" });
    }

    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: {
          PK: `CUSTOMER#${customerId}`,
          SK: "PROFILE",
        },
      }).promise();

      if (!result.Item) {
        return response(404, { message: "Customer not found" });
      }

      return response(200, result.Item);
    } catch (err) {
      console.error("🔥 Error fetching customer:", err);
      return response(500, { message: "Error fetching customer" });
    }
  }

  // POST /rewards
  if (method === "POST" && path.includes("/rewards")) {
    const { phoneNumber, rewardType, rewardPoints, period } = JSON.parse(event.body);

    if (!phoneNumber || !rewardType || !rewardPoints) {
      return response(400, { message: "Missing reward fields" });
    }

    const customerId = phoneNumber; // same as you used in POST /customer
    const customerPK = `CUSTOMER#${customerId}`;

    let customer;
    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { PK: customerPK, SK: "PROFILE" },
      }).promise();

      customer = result.Item;
      if (!customer) return response(404, { message: "Customer not found" });
    } catch (err) {
      console.error("🔥 Error fetching customer for reward:", err);
      return response(500, { message: "Error looking up customer" });
    }

    const rewardId = `REWARD#${Date.now()}`;

    const rewardData = {
      PK: customerPK,
      SK: rewardId,
      recordType: "reward",
      rewardType,
      points: rewardPoints,
      period: period || null,
      name: customer.name,
      dob: customer.dob,
      phoneNumber: customer.phoneNumber,
      createdAt: new Date().toISOString(),
    };

    try {
      await dynamo.put({
        TableName: TABLE_NAME,
        Item: rewardData,
      }).promise();

      console.log("✅ Reward saved with customer info:", rewardData);
      return response(200, { message: "Reward saved" });
    } catch (err) {
      console.error("🔥 Error saving reward:", err);
      return response(500, { message: "Error saving reward" });
    }
  }

  // GET /rewards?id=
  if (method === "GET" && path.includes("/rewards") && !path.includes("/rewards/all")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing customer ID" });

    try {
      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":sk": "REWARD#",
        },
      }).promise();

      return response(200, result.Items || []);
    } catch (err) {
      console.error("🔥 Error fetching rewards:", err);
      return response(500, { message: "Error fetching rewards" });
    }
  }

  // GET /rewards/all
  if (method === "GET" && path.includes("/rewards/all")) {
    try {
      const result = await dynamo.scan({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":sk": "REWARD#",
        },
      }).promise();

      return response(200, {
        message: "All rewards fetched",
        rewards: result.Items || [],
      });
    } catch (err) {
      console.error("🔥 Error fetching all rewards:", err);
      return response(500, { message: "Error fetching all rewards" });
    }
  }


  // PUT /rewards/:id
  if (method === "PUT" && path.includes("/rewards/")) {
    const rewardId = path.split("/rewards/")[1];
    const { rewardPoints, rewardType } = JSON.parse(event.body);

    if (!rewardId || !rewardPoints || !rewardType) {
      return response(400, { message: "Missing fields" });
    }

    // Extract customerId and rewardId
    const [customerId] = rewardId.split("#");

    try {
      const updateParams = {
        TableName: TABLE_NAME,
        Key: {
          PK: `CUSTOMER#${customerId}`, // Use composite PK
          SK: `REWARD#${rewardId}`,     // Use composite SK
        },
        UpdateExpression: "SET points = :pts, rewardType = :type",
        ExpressionAttributeValues: {
          ":pts": rewardPoints,
          ":type": rewardType,
        },
        ReturnValues: "UPDATED_NEW", // To return the updated fields
      };

      const result = await dynamo.update(updateParams).promise();
      return response(200, {
        message: "Reward updated successfully",
        updatedAttributes: result.Attributes,
      });
    } catch (err) {
      console.error("🔥 Error updating reward:", err);
      return response(500, { message: "Failed to update reward" });
    }
  }

  // DELETE /rewards/:id
  if (method === "DELETE" && path.includes("/rewards/")) {
    const rewardId = path.split("/rewards/")[1];
    if (!rewardId) return response(400, { message: "Missing reward ID" });

    // Extract customerId and rewardId from rewardId
    const [customerId] = rewardId.split("#");

    try {
      const deleteParams = {
        TableName: TABLE_NAME,
        Key: {
          PK: `CUSTOMER#${customerId}`,  // Use composite PK
          SK: `REWARD#${rewardId}`,      // Use composite SK
        },
      };

      await dynamo.delete(deleteParams).promise();
      return response(200, { message: "Reward deleted successfully" });
    } catch (err) {
      console.error("🔥 Error deleting reward:", err);
      return response(500, { message: "Failed to delete reward" });
    }
  }


  // GET /dashboard?id=
  if (method === "GET" && path.includes("/dashboard")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing ID" });

    try {
      // Fetch customer details
      const customerResult = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },
      }).promise();

      if (!customerResult.Item || customerResult.Item.recordType !== "customer") {
        return response(404, { message: "Customer not found" });
      }

      // Fetch rewards related to the customer
      const rewardsResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :rewardPrefix)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":rewardPrefix": "REWARD#",
        },
      }).promise();

      // Fetch messages for the customer (assuming you have a 'messages' table or similar)
      const messagesResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :messagePrefix)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":messagePrefix": "MESSAGE#",
        },
      }).promise();

      // Fetch coupon usage related to the customer (assuming you store coupon usage as records)
      const couponsResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :couponPrefix)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":couponPrefix": "COUPON#",
        },
      }).promise();

      // Prepare the response structure
      const responseBody = {
        customer: customerResult.Item,
        rewards: rewardsResult.Items || [],
        messages: messagesResult.Items || [],
        coupons: couponsResult.Items || [],
      };

      return response(200, responseBody);

    } catch (err) {
      console.error("🔥 Error fetching dashboard:", err);
      return response(500, { message: "Error fetching dashboard" });
    }
  }

  // POST /whatsapp?id=
  if (method === "POST" && path.includes("/whatsapp")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing customer ID" });

    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { PK: `CUSTOMER#${customerId}`, SK: "PROFILE" },  // Update this query with PK/SK
      }).promise();

      if (!result.Item) return response(404, { message: "Customer not found" });

      const {
        phoneNumber,
        templateName,
        promoCode,
        menuItem,
        occasion,
        rewardPoints,
        period,
      } = JSON.parse(event.body);

      if (!phoneNumber || !templateName) {
        return response(400, { message: "Missing phone number or template name" });
      }

      const customerName = result.Item.name;
      const brandName = "Mr. Sandwich";
      let templateParams = [];

      switch (templateName) {
        case "promocode_update":
          if (!promoCode) return response(400, { message: "Missing promo code" });
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: promoCode },
            { type: "text", text: brandName },
          ];
          break;
        case "new_menu_alert":
          if (!menuItem) return response(400, { message: "Missing menu item" });
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: menuItem },
            { type: "text", text: brandName },
          ];
          break;
        case "exclusive_offer":
          if (!occasion) return response(400, { message: "Missing occasion" });
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: occasion },
            { type: "text", text: brandName },
          ];
          break;
        case "rewards_summary":
          if (!rewardPoints || !period)
            return response(400, { message: "Missing rewards summary info" });
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: rewardPoints },
            { type: "text", text: period },
          ];
          break;
        default:
          return response(400, { message: "Invalid template name" });
      }

      const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

      const res = await axios.post(
        url,
        {
          messaging_product: "whatsapp",
          to: phoneNumber,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: templateParams
              }
            ]
          }
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response(200, { message: "WhatsApp message sent!" });

    } catch (err) {
      console.error("🔥 Error sending WhatsApp:", err.response?.data || err);
      return response(500, { message: "Error sending WhatsApp message" });
    }
  }

  // GET /messages?id=
  if (method === "GET" && path.includes("/messages")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing customer ID" });

    try {
      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",  // Adjust for the composite key
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,  // Using customerId in PK
          ":skPrefix": "MESSAGE#",  // Ensuring SK starts with "MESSAGE"
        },
      }).promise();

      return response(200, result.Items || []);
    } catch (err) {
      console.error("🔥 Error fetching messages:", err);
      return response(500, { message: "Error fetching messages" });
    }
  }


  // POST /coupons
  if (method === 'POST' && path === '/coupons') {
    const body = JSON.parse(event.body);

      const coupon = {
      ...body,
      PK: `COUPON#${body.code}`, // Unique partition key based on coupon code
      SK: 'COUPON_DETAILS', // Sort key indicating this is a coupon detail record
      recordType: 'coupon',
      usedCount: 0, // Initialize with 0 usage count
    };

    // Put the coupon item into DynamoDB with PK and SK
    await dynamo.put({
      TableName: TABLE_NAME,
      Item: coupon,
    }).promise();

    return response(200, { message: 'Coupon created' });
  }

  // GET /coupons/{couponCode}
  if (method === 'GET' && path.startsWith('/coupons/')) {
    const couponCode = path.split('/coupons/')[1];
    if (!couponCode) return response(400, { message: "Missing coupon code" });

    try {
      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk and SK = :sk', // Query based on PK (coupon code) and SK (DETAILS)
        ExpressionAttributeValues: {
          ':pk': `COUPON#${couponCode}`, // The PK is COUPON#${couponCode}
          ':sk': 'DETAILS', // The constant SK to identify the coupon detail record
        },
      }).promise();

      if (result.Items && result.Items.length === 0) {
        return response(404, { message: 'Coupon not found' });
      }

      return response(200, result.Items[0]); // Return the coupon details
    } catch (err) {
      console.error("🔥 Error fetching coupon:", err);
      return response(500, { message: "Error fetching coupon" });
    }
  }

  // GET /coupons
  if (method === 'GET' && path === '/coupons') {
    try {
      const result = await dynamo.scan({
        TableName: TABLE_NAME,
        FilterExpression: 'recordType = :type', // Filtering by recordType to only get coupons
        ExpressionAttributeValues: { ':type': 'coupon' },
      }).promise();
      return response(200, result.Items || []); // Return all coupon items
    } catch (err) {
      console.error("🔥 Error fetching coupons:", err);
      return response(500, { message: "Error fetching coupons" });
    }
  }

   // DELETE /coupons/{couponCode}
   if (method === 'DELETE' && path.startsWith('/coupons/')) {
     const couponCode = path.split('/coupons/')[1];
     if (!couponCode) return response(400, { message: "Missing coupon code" });

     try {
       const deleteParams = {
         TableName: TABLE_NAME,
         Key: {
           PK: `COUPON#${couponCode}`, // The PK based on coupon code
           SK: 'DETAILS', // Constant SK for coupon details
         },
       };

       await dynamo.delete(deleteParams).promise();
       return response(200, { message: "Coupon deleted successfully" });
     } catch (err) {
       console.error("🔥 Error deleting coupon:", err);
       return response(500, { message: "Failed to delete coupon" });
     }
   }

  // POST /orders
  if (method === 'POST' && path.startsWith('/orders')) {
    const { tableId, items, paymentDetails } = JSON.parse(event.body);

    if (!tableId || !items || !items.length || !paymentDetails) {
      return response(400, { message: "Missing required order details" });
    }

    const orderId = generateOrderId(); // Function to generate a unique order ID
    const createdAt = new Date().toISOString();

    // Calculate total payment
    const totalAmount = items.reduce((sum, item) => {
      const quantity = item.quantity || 1;
      return sum + item.price * quantity;
    }, 0);

    // Format order items for individual item entries
    const orderItems = items.map((item, index) => ({
      PK: `ORDER#${orderId}`,
      SK: `ITEM#${item.id || index + 1}`,
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      addedAt: createdAt,
    }));

    const orderParams = {
      TableName: TABLE_NAME,
      Item: {
        PK: `ORDER#${orderId}`,
        SK: 'DETAILS',
        orderId,
        tableId,
        items, // Raw items array for summary
        totalAmount,
        paymentDetails,
        status: 'PENDING',
        createdAt,
      },
    };

    try {
      // Save the main order entry
      await dynamo.put(orderParams).promise();

      // Save each item entry
      const itemPutParams = orderItems.map(item => ({
        TableName: TABLE_NAME,
        Item: item,
      }));

      await Promise.all(itemPutParams.map(params => dynamo.put(params).promise()));

      return response(200, {
        message: "Order placed successfully",
        orderId,
        totalAmount,
      });
    } catch (err) {
      console.error("🔥 Error placing order:", err);
      return response(500, { message: "Failed to place order" });
    }
  }

  return response(404, { message: "Route not found" });
};

function generateOrderId() {
  const timestamp = Date.now(); // milliseconds since epoch
  const random = Math.floor(Math.random() * 10000); // random 4-digit number
  return `ORD-${timestamp}-${random}`;
}

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});