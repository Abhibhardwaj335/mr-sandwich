import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const CUSTOMER_PATH = '/dashboard';
const PROFILE_SK = 'PROFILE';
const REWARD_PREFIX = 'REWARD#';
const MESSAGE_PREFIX = 'MESSAGE#';
const COUPON_PREFIX = 'COUPON#';
const RECORD_TYPE_CUSTOMER = 'customer';

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);
  // GET /dashboard?id= - Fetch customer dashboard with related data
  if (httpMethod === 'GET' && path.includes(CUSTOMER_PATH)) {
    const customerId = event.queryStringParameters?.id;
    if (!customerId) {
      return error({ message: "Missing customer ID" }, 400);
    }

    try {
      const customerResult = await dynamo.get({
        TableName: TABLE_NAME,
        Key: {
          PK: `CUSTOMER#${customerId}`,
          SK: PROFILE_SK,
        },
      }).promise();

      if (!customerResult.Item || customerResult.Item.recordType !== RECORD_TYPE_CUSTOMER) {
        return error({ message: "Customer not found" }, 404);
      }

      const rewardsResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :rewardPrefix)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":rewardPrefix": REWARD_PREFIX,
        },
      }).promise();

      const messagesResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :messagePrefix)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":messagePrefix": MESSAGE_PREFIX,
        },
      }).promise();

      const couponsResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :couponPrefix)",
        ExpressionAttributeValues: {
          ":pk": `CUSTOMER#${customerId}`,
          ":couponPrefix": COUPON_PREFIX,
        },
      }).promise();

      const responseBody = {
        customer: customerResult.Item,
        rewards: rewardsResult.Items || [],
        messages: messagesResult.Items || [],
        coupons: couponsResult.Items || [],
      };

      return success(200, responseBody);
    } catch (err: unknown) {
      return handleError("fetching dashboard:", err);
    }
  }

  // This should be outside the GET block
  return error({ message: "Method not supported" }, 405);
};
