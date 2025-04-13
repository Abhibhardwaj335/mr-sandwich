import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
  const method = event.httpMethod;

  try {
    // POST /orders
      if (method === 'POST' && path.startsWith('/orders')) {
        const { tableId, items, paymentDetails } = JSON.parse(event.body);

        if (!tableId || !items || !items.length || !paymentDetails) {
          return response(400, { message: "Missing required order details" });
        }

        const orderId = generateOrderId(); // Function to generate a unique order ID
        const createdAt = new Date().toISOString();

        // Calculate total payment
        const totalAmount = items.reduce((sum, item) => {
          const quantity = item.quantity || 1;
          return sum + item.price * quantity;
        }, 0);

        // Format order items for individual item entries
        const orderItems = items.map((item, index) => ({
          PK: `ORDER#${orderId}`,
          SK: `ITEM#${item.id || index + 1}`,
          name: item.name,
          price: item.price,
          quantity: item.quantity || 1,
          addedAt: createdAt,
        }));

        const orderParams = {
          TableName: TABLE_NAME,
          Item: {
            PK: `ORDER#${orderId}`,
            SK: 'DETAILS',
            orderId,
            tableId,
            items, // Raw items array for summary
            totalAmount,
            paymentDetails,
            status: 'PENDING',
            createdAt,
          },
        };

        try {
          // Save the main order entry
          await dynamo.put(orderParams).promise();

          // Save each item entry
          const itemPutParams = orderItems.map(item => ({
            TableName: TABLE_NAME,
            Item: item,
          }));

          await Promise.all(itemPutParams.map(params => dynamo.put(params).promise()));

          return response(200, {
            message: "Order placed successfully",
            orderId,
            totalAmount,
          });
        } catch (err) {
          console.error("🔥 Error placing order:", err);
          return response(500, { message: "Failed to place order" });
        }
      }
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};

function generateOrderId() {
  const timestamp = Date.now(); // milliseconds since epoch
  const random = Math.floor(Math.random() * 10000); // random 4-digit number
  return `ORD-${timestamp}-${random}`;
}
