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

  // POST /customer
  if (method === "POST" && path.includes("/customer")) {
    const { name, phoneNumber, dob } = JSON.parse(event.body);

    if (!name || !phoneNumber || !dob) {
      return response(400, { message: "Missing fields" });
    }

    try {
      const customerPK = phoneNumber.substring(3);
      const customerData = {
        customerId: customerPK,
        name,
        phoneNumber,
        dob,
        recordType: "customer",
        createdAt: new Date().toISOString(),
      };

      await dynamo.put({
        TableName: TABLE_NAME,
        Item: customerData,
      }).promise();

      console.log("✅ Customer saved:", customerData);
      return response(200, { message: "Customer saved", customerId: customerPK });

    } catch (err) {
      console.error("🔥 Error saving customer:", err);
      return response(500, { message: "Error saving customer" });
    }
  }

  // GET /customer?id=
  if (method === "GET" && path.includes("/customer")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing ID" });

    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { customerId },
      }).promise();

      if (!result.Item)
        return response(404, { message: "Customer not found" });

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

    const customerId = phoneNumber;

    // 1️⃣ Fetch customer info
    let customer;
    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { customerId },
      }).promise();
      customer = result.Item;
      if (!customer) {
        return response(404, { message: "Customer not found" });
      }
    } catch (err) {
      console.error("🔥 Error fetching customer for reward:", err);
      return response(500, { message: "Error looking up customer" });
    }

    // 2️⃣ Build reward item including customer info
    const rewardData = {
      customerId,
      rewardId: `${customerId}#${Date.now()}`,
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

  // GET /rewards?id=1234567890
  if (method === "GET" && path.includes("/rewards") && !path.includes("/rewards/all")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing customer ID" });

    try {
      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "customerId = :cid",
        FilterExpression: "recordType = :rtype",
        ExpressionAttributeValues: {
          ":cid": customerId,
          ":rtype": "reward",
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
        FilterExpression: "#type = :rewardType",
        ExpressionAttributeNames: {
          "#type": "recordType",
        },
        ExpressionAttributeValues: {
          ":rewardType": "reward",
        },
      }).promise();

      const rewards = result.Items || [];

      return response(200, {
        message: "All rewards fetched",
        rewards,
      });

    } catch (err) {
      console.error("🔥 Error fetching all rewards:", err);
      return response(500, { message: "Error fetching all rewards" });
    }
  }


  // ... imports and setup

  // PUT /rewards/:id
  if (method === "PUT" && path.includes("/rewards/")) {
    const rewardId = path.split("/rewards/")[1];
    const { rewardPoints, rewardType } = JSON.parse(event.body);

    if (!rewardId || !rewardPoints || !rewardType) {
      return response(400, { message: "Missing fields" });
    }

    try {
      const updateParams = {
        TableName: TABLE_NAME,
        Key: { customerId: rewardId.split("#")[0], rewardId },
        UpdateExpression: "SET points = :pts, rewardType = :type",
        ExpressionAttributeValues: {
          ":pts": rewardPoints,
          ":type": rewardType,
        },
      };

      await dynamo.update(updateParams).promise();
      return response(200, { message: "Reward updated successfully" });
    } catch (err) {
      console.error("🔥 Error updating reward:", err);
      return response(500, { message: "Failed to update reward" });
    }
  }

  // DELETE /rewards/:id
  if (method === "DELETE" && path.includes("/rewards/")) {
    const rewardId = path.split("/rewards/")[1];
    if (!rewardId) return response(400, { message: "Missing reward ID" });

    try {
      const deleteParams = {
        TableName: TABLE_NAME,
        Key: { customerId: rewardId.split("#")[0], rewardId },
      };

      await dynamo.delete(deleteParams).promise();
      return response(200, { message: "Reward deleted successfully" });
    } catch (err) {
      console.error("🔥 Error deleting reward:", err);
      return response(500, { message: "Failed to delete reward" });
    }
  }

  // POST /whatsapp?id=
  if (method === "POST" && path.includes("/whatsapp")) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return response(400, { message: "Missing customer ID" });

    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { customerId }
      }).promise();

      if (!result.Item)
        return response(404, { message: "Customer not found" });

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

      console.log("✅ WhatsApp response:", res.data);
      return response(200, { message: "WhatsApp message sent!" });

    } catch (err) {
      console.error("🔥 Error sending WhatsApp:", err.response?.data || err);
      return response(500, { message: "Error sending WhatsApp message" });
    }
  }

  return response(404, { message: "Route not found" });
};

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  },
  body: JSON.stringify(body),
});
