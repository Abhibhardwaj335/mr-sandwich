import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';
import { calculateTotalAmount, buildOrderParams } from '../utils/orderUtil';

interface Item {
  id?: string;
  name: string;
  price: number;
  quantity?: number;
}

interface PaymentDetails {
  method: string;
  amount: number;
  transactionId?: string;
}

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod, queryStringParameters } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);

  // ---------- CREATE ORDER ----------
  if (httpMethod === 'POST' && path === '/orders') {
    const { tableId, items, paymentDetails } = event.body ? JSON.parse(event.body) : {};

    if (!tableId) return error({ message: 'Missing tableId' }, 400);
    if (!items || !items.length) return error({ message: 'Missing order items' }, 400);
    if (!paymentDetails) return error({ message: 'Missing payment details' }, 400);

    const orderId = generateOrderId();
    const createdAt = new Date().toISOString();

    const orderParams = {
      TableName: TABLE_NAME,
      ...buildOrderParams(orderId, tableId, items, paymentDetails, createdAt),
    };

    try {
      await dynamo.put(orderParams).promise();

      const totalAmount = calculateTotalAmount(items);
      return success(201, { message: 'Order placed successfully', orderId, totalAmount });
    } catch (err: unknown) {
      return handleError('placing order:', err);
    }
  }

  // ---------- UPDATE EXISTING ORDER ----------
  if (httpMethod === 'PUT' && path === '/orders') {
    const orderId = queryStringParameters?.id;
    const { items, paymentDetails, tableId } = event.body ? JSON.parse(event.body) : {};

    if (!orderId) return error({ message: 'Missing orderId in query parameters' }, 400);
    if (!items || !items.length) return error({ message: 'Missing updated order items' }, 400);
    if (!paymentDetails) return error({ message: 'Missing payment details' }, 400);

    const updatedAt = new Date().toISOString();

    try {
      // Fetch existing order
      const existingOrderResp = await dynamo
        .get({
          TableName: TABLE_NAME,
          Key: {
            PK: `ORDER#${orderId}`,
            SK: 'ORDER_DETAILS',
          },
        })
        .promise();

      if (!existingOrderResp.Item) {
        return error({ message: 'Order not found' }, 404);
      }

      const existingOrder = existingOrderResp.Item;
      const existingItems = existingOrder.items || [];

      // Append new items
      const combinedItems = [...existingItems, ...items];
      const totalAmount = calculateTotalAmount(combinedItems);

      const updatedOrder = {
        ...existingOrder,
        items: combinedItems,
        totalAmount,
        paymentDetails,
        tableId: tableId || existingOrder.tableId,
        updatedAt,
      };

      await dynamo
        .put({
          TableName: TABLE_NAME,
          Item: updatedOrder,
        })
        .promise();

      return success(200, {
        message: 'Order updated successfully',
        orderId,
        totalAmount,
      });
    } catch (err: unknown) {
      return handleError('updating order:', err);
    }
  }

  return error({ message: 'Method not supported' }, 405);
};

// Utility to generate order ID
function generateOrderId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `ORD-${timestamp}-${random}`;
}
