import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
const method = event.httpMethod;

try {
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
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};
