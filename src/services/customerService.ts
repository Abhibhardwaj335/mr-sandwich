import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
  const method = event.httpMethod;
  try {
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
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};
