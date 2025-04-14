import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const REWARD_PREFIX = 'REWARD#';
const CUSTOMER_PROFILE_SK = 'CUSTOMER_PROFILE';
const RECORD_TYPE_REWARD = 'reward';

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod, queryStringParameters } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);

  // POST /rewards - Create a new reward
  if (httpMethod === 'POST' && path === '/rewards') {
    const { phoneNumber, rewardType, rewardPoints, rewardPeriod } = event.body ? JSON.parse(event.body) : {};

    if (!phoneNumber || !rewardType || !rewardPoints) {
      return error({ message: "Missing reward fields" }, 400);
    }

    const customerId = phoneNumber;
    const customerPK = `CUSTOMER#${customerId}`;

    try {
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { PK: customerPK, SK: CUSTOMER_PROFILE_SK },
      }).promise();

      const customer = result.Item;
      if (!customer) return error({ message: "Customer not found" }, 404);

      const rewardId = `${Date.now()}`; // Just the timestamp
      const rewardData = {
        PK: customerPK,
        SK: `${REWARD_PREFIX}${rewardId}`,
        recordType: RECORD_TYPE_REWARD,
        rewardType,
        points: rewardPoints,
        period: rewardPeriod || null,
        name: customer.name,
        dob: customer.dob,
        phoneNumber: customer.phoneNumber,
        createdAt: new Date().toISOString(),
      };

      await dynamo.put({ TableName: TABLE_NAME, Item: rewardData }).promise();
      return success(201, { message: "Reward saved", rewardId });
    } catch (err) {
      return handleError("saving reward", err);
    }
  }

  // GET /rewards?id= - Fetch rewards by customer ID
  if (httpMethod === 'GET' && path === '/rewards' && queryStringParameters?.id) {
    const customerId = queryStringParameters.id;
    const customerPK = `CUSTOMER#${customerId}`;

    try {
      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": customerPK,
          ":sk": REWARD_PREFIX,
        },
      }).promise();
      return success(200, result.Items || []);
    } catch (err) {
      return handleError("fetching rewards", err);
    }
  }

  // GET /rewards/all - Fetch all rewards
  if (httpMethod === 'GET' && path === '/rewards/all') {
    try {
      const result = await dynamo.scan({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":sk": REWARD_PREFIX,
        },
      }).promise();
      return success(200, { rewards: result.Items || []});
    } catch (err) {
      return handleError("fetching all rewards", err);
    }
  }

  // PUT /rewards/:id - Update reward points and type
  if (httpMethod === 'PUT' && path.startsWith('/rewards/')) {
    const rewardKey = path.split('/rewards/')[1];
    const { rewardPoints, rewardType } = event.body ? JSON.parse(event.body) : {};

    if (!rewardKey || !rewardPoints || !rewardType) {
      return error({ message: "Missing fields" }, 400);
    }

    const [customerId, timestamp] = rewardKey.split('#');
    const rewardSK = `${REWARD_PREFIX}${timestamp}`;

    try {
      const result = await dynamo.update({
        TableName: TABLE_NAME,
        Key: {
          PK: `CUSTOMER#${customerId}`,
          SK: rewardSK,
        },
        UpdateExpression: "SET points = :pts, rewardType = :type",
        ExpressionAttributeValues: {
          ":pts": rewardPoints,
          ":type": rewardType,
        },
        ReturnValues: "UPDATED_NEW",
      }).promise();

      return success(200, {message: "Reward updated successfully"});
    } catch (err) {
      return handleError("updating reward", err);
    }
  }

  // DELETE /rewards/:id - Delete a reward
  if (httpMethod === 'DELETE' && path.startsWith('/rewards/')) {
    const rewardKey = path.split('/rewards/')[1];

    if (!rewardKey) return error({ message: "Missing reward ID" }, 400);

    const [customerId, timestamp] = rewardKey.split('#');
    const rewardSK = `${REWARD_PREFIX}${timestamp}`;

    try {
      await dynamo.delete({
        TableName: TABLE_NAME,
        Key: {
          PK: `CUSTOMER#${customerId}`,
          SK: rewardSK,
        },
      }).promise();

      return success(200, { message: "Reward deleted successfully" });
    } catch (err) {
      return handleError("deleting reward", err);
    }
  }
  return error({ message: "Method not supported" }, 405);
};