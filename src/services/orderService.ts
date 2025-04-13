import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

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
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);
  if (httpMethod === 'POST' && path === '/orders') {
    const { tableId, items, paymentDetails } = event.body ? JSON.parse(event.body) : {};

    if (!tableId) {
      return error({ message: "Missing tableId" }, 400);
    }

    if (!items || !items.length) {
      return error({ message: "Missing order items" }, 400);
    }

    if (!paymentDetails) {
      return error({ message: "Missing payment details" }, 400);
    }

    const orderId = generateOrderId();
    const createdAt = new Date().toISOString();

    // Correct typing for 'sum' and 'item'
    const totalAmount = items.reduce((sum: number, item: Item) => sum + item.price * (item.quantity || 1), 0);

    // Correct typing for 'item' and 'index'
    const orderItems = items.map((item: Item, index: number) => ({
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
        items,
        totalAmount,
        paymentDetails,
        status: 'PENDING',
        createdAt,
      },
    };

    try {
      await dynamo.put(orderParams).promise();

      const batchParams = {
        RequestItems: {
          [TABLE_NAME]: orderItems.map((item: Item) => ({  // Type 'item' as 'Item'
            PutRequest: {
              Item: item,
            },
          })),
        },
      };

      await dynamo.batchWrite(batchParams).promise();

      return success(201, { message: "Order placed successfully", orderId, totalAmount });

    } catch (err: unknown) {
      return handleError("placing order:", err);
    }
  }
  return error({ message: "Method not supported" }, 405);
};

function generateOrderId(): string {
  const timestamp = Date.now(); // Get the current timestamp
  const random = Math.floor(Math.random() * 10000); // Random 4-digit number
  return `ORD-${timestamp}-${random}`;
}
