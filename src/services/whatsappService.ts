import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
  const method = event.httpMethod;

  try {
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
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};
