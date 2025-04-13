import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
  const method = event.httpMethod;

  try {
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
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};
