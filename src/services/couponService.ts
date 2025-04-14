import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const COUPON_PATH = '/coupons';
const COUPON_DETAILS_SK = 'COUPON_DETAILS';
const RECORD_TYPE_COUPON = 'coupon';

export const handler = async (event: APIGatewayEvent, context: Context) => {
  try {
    const { path, httpMethod } = event;
    console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);
    // POST /coupons - Create a new coupon
    if (httpMethod === 'POST' && path === COUPON_PATH) {
      const body = event.body ? JSON.parse(event.body) : {};;

      if (!body.code || !body.description || !body.title) {
        return error({ message: "Missing required coupon fields" }, 400);
      }

      const coupon = {
        ...body,
        PK: `COUPON#${body.code}`,
        SK: COUPON_DETAILS_SK,
        recordType: RECORD_TYPE_COUPON,
        usedCount: 0,
      };

      await dynamo.put({
        TableName: TABLE_NAME,
        Item: coupon,
      }).promise();

      return success(201, { message: 'Coupon created successfully' });
    }

    // ---------- UPDATE COUPON USAGE COUNT ----------
    if (httpMethod === 'PUT' && path.startsWith(COUPON_PATH)) {
      const couponCode = event.queryStringParameters?.code;

      if (!couponCode) {
        return error({ message: "Missing coupon code in query parameters" }, 400);
      }

      try {
        const couponKey = {
          PK: `COUPON#${couponCode}`,
          SK: COUPON_DETAILS_SK,
        };

        const updateParams = {
          TableName: TABLE_NAME,
          Key: couponKey,
          UpdateExpression: "SET usedCount = if_not_exists(usedCount, :zero) + :incr",
          ExpressionAttributeValues: {
            ":zero": 0,
            ":incr": 1,
          },
          ReturnValues: "UPDATED_NEW",
        };

        const result = await dynamo.update(updateParams).promise();

        return success(200, {
          message: `Coupon ${couponCode} usage incremented`,
          updatedCount: result.Attributes?.usedCount,
        });
      } catch (err) {
        return handleError("updating coupon usage:", err);
      }
    }

    // GET /coupons/{couponCode} - Fetch details of a specific coupon
    if (httpMethod === 'GET' && path.startsWith(COUPON_PATH) && event.queryStringParameters?.code) {
      const couponCode = event.queryStringParameters.code.trim();

      const result = await dynamo.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk and SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `COUPON#${couponCode}`,
          ':sk': COUPON_DETAILS_SK,
        },
      }).promise();

      if (!result.Items || result.Items.length === 0) {
        return error({ message: 'Coupon not found' }, 404);
      }

      return success(200, result.Items[0]);
    }

    // GET /coupons - Fetch all coupons
    if (httpMethod === 'GET' && !event.queryStringParameters?.code) {
      const result = await dynamo.scan({
        TableName: TABLE_NAME,
        FilterExpression: 'recordType = :type',
        ExpressionAttributeValues: {
          ':type': RECORD_TYPE_COUPON,
        },
      }).promise();

      return success(200, result.Items || []);
    }

    // DELETE /coupons/{couponCode} - Delete a specific coupon
    if (httpMethod === 'DELETE' && path.startsWith(COUPON_PATH)) {
      const couponCode = event.queryStringParameters?.code?.trim();
      if (!couponCode) {
        return error({ message: "Missing coupon code" }, 400);
      }

      const deleteParams = {
        TableName: TABLE_NAME,
        Key: {
          PK: `COUPON#${couponCode}`,
          SK: COUPON_DETAILS_SK,
        },
      };

      await dynamo.delete(deleteParams).promise();
      return success(201, { message: "Coupon deleted successfully" });
    }

    return error({ message: "Method not supported" }, 405);
  } catch (err: unknown) {
    return handleError("in coupon service:", err);
  }
};
