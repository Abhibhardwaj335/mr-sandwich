import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const REWARD_PREFIX = 'REWARD#';
const CUSTOMER_PROFILE_SK = 'CUSTOMER_PROFILE';
const RECORD_TYPE_REWARD = 'reward';

interface RewardItem {
  PK: string;
  SK: string;
  recordType: string;
  rewardType: string;
  points: number;
  period?: string;
  name?: string;
  dob?: string;
  phoneNumber?: string;
  createdAt: string;
}


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
      // Check if customer exists
      const customerResult = await dynamo.get({
        TableName: TABLE_NAME,
        Key: { PK: customerPK, SK: CUSTOMER_PROFILE_SK },
      }).promise();

      const customer = customerResult.Item;
      if (!customer) return error({ message: "Customer not found" }, 404);

      // Check if customer already has a reward of this type
      const existingRewardsResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :reward_prefix)',
        FilterExpression: 'rewardType = :rewardType',
        ExpressionAttributeValues: {
          ':pk': customerPK,
          ':reward_prefix': REWARD_PREFIX,
          ':rewardType': rewardType
        }
      }).promise();

      if (existingRewardsResult.Items && existingRewardsResult.Items.length > 0) {
        // Customer already has this reward type
        return error({
          message: "Customer already has this reward type",
          details: "EXISTING_REWARD"
        }, 409); // 409 Conflict
      }

      // If no existing reward found, proceed with creating a new one
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

  // PUT /rewards/redeem
  if (httpMethod === 'PUT' && path === '/rewards/redeem') {
    const { phoneNumber, pointsToRedeem } = event.body ? JSON.parse(event.body) : {};

    if (!phoneNumber || !pointsToRedeem || pointsToRedeem <= 0) {
      return error({ message: "Missing phone number or invalid points to redeem" }, 400);
    }

    const customerPK = `CUSTOMER#${phoneNumber}`;
    let remainingPointsToRedeem = pointsToRedeem;

    try {
      // 1. Get all rewards for this customer
      const rewardsResult = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :reward_prefix)',
        ExpressionAttributeValues: {
          ':pk': customerPK,
          ':reward_prefix': REWARD_PREFIX,
        }
      }).promise();

      const rewards = rewardsResult.Items as RewardItem[] || [];
      if (rewards.length === 0) {
        return error({ message: "No rewards found for this customer" }, 404);
      }

      // 2. Calculate total available points
      const totalAvailablePoints = rewards.reduce((total, reward) => total + reward.points, 0);
      if (totalAvailablePoints < pointsToRedeem) {
        return error({ message: `Not enough points. Available: ${totalAvailablePoints}, Requested: ${pointsToRedeem}` }, 400);
      }

      // 3. Sort rewards by createdAt
      rewards.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // 4. Prepare updated/deleted rewards
      const updatedRewards = [];

      for (const reward of rewards) {
        if (remainingPointsToRedeem <= 0) break;

        const pointsToDeduct = Math.min(reward.points, remainingPointsToRedeem);
        const newPoints = reward.points - pointsToDeduct;

        updatedRewards.push({
          ...reward,              // keep all original fields
          points: newPoints       // update points
        });

        remainingPointsToRedeem -= pointsToDeduct;
      }

      // 5. Batch write: update or delete rewards
      const batchWriteParams = {
        RequestItems: {
          [TABLE_NAME]: updatedRewards.map(reward => {
            if (reward.points > 0) {
              return {
                PutRequest: {
                  Item: reward
                }
              };
            } else {
              return {
                DeleteRequest: {
                  Key: {
                    PK: reward.PK,
                    SK: reward.SK
                  }
                }
              };
            }
          })
        }
      };

      await dynamo.batchWrite(batchWriteParams).promise();

      return success(200, {
        message: "Points redeemed successfully",
        pointsRedeemed: pointsToRedeem
      });
    } catch (err) {
      return handleError("redeeming points", err);
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

  // PUT /rewards?id=...
  if (httpMethod === 'PUT' && path === '/rewards') {
    const customerId = queryStringParameters?.id;
    const { rewardPoints, rewardType, rewardPeriod, timestamp } = event.body ? JSON.parse(event.body) : {};

    if (!customerId || !rewardType || !rewardPoints || !timestamp) {
      return error({ message: "Missing required fields" }, 400);
    }

    const customerPK = `CUSTOMER#${customerId}`;
    const rewardSK = `REWARD#${timestamp}`;

    try {
      await dynamo.update({
        TableName: TABLE_NAME,
        Key: {
          PK: customerPK,
          SK: rewardSK,
        },
        UpdateExpression: "SET points = :pts, rewardType = :type, period = :period",
        ExpressionAttributeValues: {
          ":pts": rewardPoints,
          ":type": rewardType,
          ":period": rewardPeriod || "Weekly",
        },
        ReturnValues: "UPDATED_NEW",
      }).promise();

      return success(200, { message: "Reward updated successfully" });
    } catch (err) {
      return handleError("updating reward", err);
    }
  }

  // DELETE /rewards?id=...&timestamp=...&rewardType=...
  if (httpMethod === 'DELETE' && path === '/rewards') {
    const customerId = queryStringParameters?.id;
    const timestamp = queryStringParameters?.timestamp;
    const rewardType = queryStringParameters?.rewardType;

    if (!customerId || !timestamp || !rewardType) {
      return error({ message: "Missing customer ID, reward type, or timestamp" }, 400);
    }

    const customerPK = `CUSTOMER#${customerId}`;
    const rewardSK = `REWARD#${timestamp}`;

    try {
      // Fetch the reward first to verify rewardType matches
      const result = await dynamo.get({
        TableName: TABLE_NAME,
        Key: {
          PK: customerPK,
          SK: rewardSK,
        },
      }).promise();

      const reward = result.Item;

      if (!reward) {
        return error({ message: "Reward not found" }, 404);
      }

      if (reward.rewardType !== rewardType) {
        return error({ message: "Reward type mismatch" }, 400);
      }

      await dynamo.delete({
        TableName: TABLE_NAME,
        Key: {
          PK: customerPK,
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
