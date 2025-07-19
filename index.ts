import { APIGatewayEvent, Context } from 'aws-lambda';
import { handler as authHandler } from './src/services/authService';
import { handler as orderHandler } from './src/services/orderService';
import { handler as customerHandler } from './src/services/customerService';
import { handler as rewardHandler } from './src/services/rewardService';
import { handler as couponHandler } from './src/services/couponService';
import { handler as dashboardHandler } from './src/services/dashboardService';
import { handler as whatsappHandler } from './src/services/whatsappService';
import { handler as expenseHandler } from './src/services/expenseService';
import { handler as saleHandler } from './src/services/saleService';

export const handler = async (event: APIGatewayEvent, context: Context) => {  // Type 'event' as 'APIGatewayEvent' and 'context' as 'Context'
  const path = event.path;
  const method = event.httpMethod;
  console.log('📥 Request received:', JSON.stringify(event));
  if (path.startsWith('/login')) return authHandler(event, context);
  if (path.startsWith('/orders')) return orderHandler(event, context);
  if (path.startsWith('/customer')) return customerHandler(event, context);
  if (path.startsWith('/rewards')) return rewardHandler(event, context);
  if (path.startsWith('/coupons')) return couponHandler(event, context);
  if (path.startsWith('/dashboard')) return dashboardHandler(event, context);
  if (path.startsWith('/messages')) return whatsappHandler(event, context);
  if (path.startsWith('/whatsapp')) return whatsappHandler(event, context);
  if (path.startsWith('/expense')) return expenseHandler(event, context);
  if (path.startsWith('/sale')) return saleHandler(event, context);

  return {
    statusCode: 404,
    body: JSON.stringify({ message: 'Route not found' }),
  };
};
