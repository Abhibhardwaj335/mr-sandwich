import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
  const method = event.httpMethod;

  try {
    // POST /coupons
      if (method === 'POST' && path === '/coupons') {
        const body = JSON.parse(event.body);

          const coupon = {
          ...body,
          PK: `COUPON#${body.code}`, // Unique partition key based on coupon code
          SK: 'COUPON_DETAILS', // Sort key indicating this is a coupon detail record
          recordType: 'coupon',
          usedCount: 0, // Initialize with 0 usage count
        };

        // Put the coupon item into DynamoDB with PK and SK
        await dynamo.put({
          TableName: TABLE_NAME,
          Item: coupon,
        }).promise();

        return response(200, { message: 'Coupon created' });
      }

      // GET /coupons/{couponCode}
      if (method === 'GET' && path.startsWith('/coupons') && event.queryStringParameters?.code?.trim()) {
        const couponCode = event.queryStringParameters?.code;
        if (!couponCode) return response(400, { message: "Missing coupon code" });

        try {
          const result = await dynamo.query({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk and SK = :sk', // Query based on PK (coupon code) and SK (DETAILS)
            ExpressionAttributeValues: {
              ':pk': `COUPON#${couponCode}`, // The PK is COUPON#${couponCode}
              ':sk': 'COUPON_DETAILS', // The constant SK to identify the coupon detail record
            },
          }).promise();

          if (result.Items && result.Items.length === 0) {
            return response(404, { message: 'Coupon not found' });
          }

          return response(200, result.Items[0]); // Return the coupon details
        } catch (err) {
          console.error("🔥 Error fetching coupon:", err);
          return response(500, { message: "Error fetching coupon" });
        }
      }

      // GET /coupons
      if (method === 'GET' && path.startsWith('/coupons') && !event.queryStringParameters?.code?.trim()) {
        try {
          const result = await dynamo.scan({
            TableName: TABLE_NAME,
            FilterExpression: 'recordType = :type', // Filtering by recordType to only get coupons
            ExpressionAttributeValues: { ':type': 'coupon' },
          }).promise();
          return response(200, result.Items || []); // Return all coupon items
        } catch (err) {
          console.error("🔥 Error fetching coupons:", err);
          return response(500, { message: "Error fetching coupons" });
        }
      }

       // DELETE /coupons/{couponCode}
       if (method === 'DELETE' && path.startsWith('/coupons')) {
         const couponCode = event.queryStringParameters?.code;
         if (!couponCode) return response(400, { message: "Missing coupon code" });

         try {
           const deleteParams = {
             TableName: TABLE_NAME,
             Key: {
               PK: `COUPON#${couponCode}`, // The PK based on coupon code
               SK: 'COUPON_DETAILS', // Constant SK for coupon details
             },
           };

           await dynamo.delete(deleteParams).promise();
           return response(200, { message: "Coupon deleted successfully" });
         } catch (err) {
           console.error("🔥 Error deleting coupon:", err);
           return response(500, { message: "Failed to delete coupon" });
         }
       }
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};
