import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import axios from 'axios';
import { handleError } from '../utils/errorHandler';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN!;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const ADMIN_WHATSAPP_PHONE_NUMBER = process.env.ADMIN_WHATSAPP_PHONE_NUMBER!;
const BRAND_NAME = "Mr. Sandwich";
const CUSTOMER_PROFILE_SK = 'CUSTOMER_PROFILE';
// Define a type for the expected response item structure
interface CustomerProfile {
  PK: string;
  SK: string;
  name: string;
  phoneNumber: string;
}

interface Message {
  PK: string;
  SK: string;
  body: string;
}

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);
  // === POST /whatsapp?id= ===
  if (httpMethod === "POST" && path === "/whatsapp") {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return error({ message: "Missing customer ID" }, 400);
  
    try {
      // Special handling for admin notifications which don't need customer lookup
      const { phoneNumber: basePhoneNumber, templateName, promoCode, menuItem, occasion, rewardPoints, rewardPeriod, tableId, orderTotal, items } =
        event.body ? JSON.parse(event.body) : {};

      const phoneNumber = customerId == "admin" ? ADMIN_WHATSAPP_PHONE_NUMBER : basePhoneNumber;

      if (!phoneNumber || !templateName) {
        return error({ message: "Missing phone number or template name" }, 400);
      }
  
      // Ensure phoneNumber is a valid string
      if (typeof phoneNumber !== 'string') {
        return error({ message: "Invalid phone number" }, 400);
      }

      let templateParams: { type: string; text: string }[] = [];
      let customerName = "Admin"; // Default for admin notifications
  
      // If not an admin notification, fetch customer profile
      if (customerId !== "admin") {
        // Fetch customer profile from DynamoDB
        const result = await dynamo.get({
          TableName: TABLE_NAME,
          Key: {
            PK: `CUSTOMER#${customerId}`,
            SK: CUSTOMER_PROFILE_SK,
          },
        }).promise();
  
        if (!result.Item) return error({ message: "Customer not found" }, 404);
        customerName = (result.Item as CustomerProfile).name; // Typecasting
      }
  
      switch (templateName) {
        case "promocode_update":
          if (!promoCode) return error({ message: "Missing promo code" }, 400);
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: promoCode },
            { type: "text", text: BRAND_NAME },
          ];
          break;
  
        case "new_menu_alert":
          if (!menuItem) return error({ message: "Missing menu item" }, 400);
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: menuItem },
            { type: "text", text: BRAND_NAME },
          ];
          break;
  
        case "exclusive_offer":
          if (!occasion) return error({ message: "Missing occasion" }, 400);
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: occasion },
            { type: "text", text: BRAND_NAME },
          ];
          break;
  
        case "rewards_summary":
          if (!rewardPoints || !rewardPeriod)
            return error({ message: "Missing rewards summary info" }, 400);
          templateParams = [
            { type: "text", text: customerName },
            { type: "text", text: rewardPoints.toString() }, // Convert to string
            { type: "text", text: rewardPeriod },
          ];
          break;
          
        case "new_order":
          if (!tableId || !orderTotal || !items)
            return error({ message: "Missing order information" }, 400);
          templateParams = [
            { type: "text", text: tableId },
            { type: "text", text: orderTotal },
            { type: "text", text: items },
          ];
          break;
          
        case "order_update":
          if (!tableId || !orderTotal || !items)
            return error({ message: "Missing order information" }, 400);
          templateParams = [
            { type: "text", text: tableId },
            { type: "text", text: orderTotal },
            { type: "text", text: items },
          ];
          break;
  
        default:
          return error({ message: "Invalid template name" }, 400);
      }
  
      // Send WhatsApp message via the API
      const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  
      const response = await axios.post(
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
                parameters: templateParams,
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
  
      return success(200, { message: "WhatsApp message sent!" });
    } catch (err: unknown) {
      return handleError("sending WhatsApp", err);
    }
  }

  // === GET /messages?id= ===
  if (httpMethod === "GET" && path === "/messages") {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) return error({ message: "Missing customer ID" }, 400);

    try {
      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":sk": "MESSAGE#",
        },
      }).promise();
      return success(200, { messages: result.Items || [] });
    } catch (err: unknown) {
      return handleError("fetching messages", err);
    }
  }

  return error({ message: "Method not supported" }, 405);
};
