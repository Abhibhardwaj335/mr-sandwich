import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const CUSTOMER_PATH = '/customer';
const PROFILE_SK = 'PROFILE';
const RECORD_TYPE_CUSTOMER = 'customer';

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);
  try {
    // POST /customer - Create a new customer
    if (httpMethod === 'POST' && path.includes(CUSTOMER_PATH)) {
      const { name, phoneNumber, dob } = event.body ? JSON.parse(event.body) : {};
      if (!name || !phoneNumber || !dob) {
        return error({ message: "Missing required fields" }, 400);
      }

      const customerId = phoneNumber.substring(3);
      const customerData = {
        PK: `CUSTOMER#${customerId}`,
        SK: PROFILE_SK,
        recordType: RECORD_TYPE_CUSTOMER,
        name,
        phoneNumber,
        dob,
        createdAt: new Date().toISOString(),
      };

      try {
        await dynamo.put({
          TableName: TABLE_NAME,
          Item: customerData,
        }).promise();

        console.log("✅ Customer saved:", customerData);
        return success(201, { message: "Customer saved successfully", customerId });
      } catch (err) {
        return handleError("saving customer:", err);
      }
    }

    // GET /customer?id= - Fetch customer profile by ID
    if (httpMethod === 'GET' && path.includes(CUSTOMER_PATH)) {
      const customerId = event.queryStringParameters?.id;
      if (!customerId) {
        return error({ message: "Missing customer ID" }, 400);
      }

      try {
        const result = await dynamo.get({
          TableName: TABLE_NAME,
          Key: {
            PK: `CUSTOMER#${customerId}`,
            SK: PROFILE_SK,
          },
        }).promise();

        if (!result.Item) {
          return error({ message: "Customer not found" }, 404);
        }

        return success(200, result.Item);
      } catch (err) {
        return handleError("fetching customer:", err);
      }
    }

    return error({ message: "Method not supported" }, 405);

  } catch (err: unknown) {
    return handleError("🔥 Error customer service:", err);
  }
};
