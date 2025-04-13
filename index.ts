import { handler as authHandler } from './src/services/authService';
import { handler as orderHandler } from './src/services/orderService';
import { handler as customerHandler } from './src/services/customerService';
import { handler as rewardHandler } from './src/services/rewardService';
import { handler as couponHandler } from './src/services/couponService';
import { handler as dashboardHandler } from './src/services/dashboardService';
import { handler as whatsappHandler } from './src/services/whatsappService';


export const handler = async (event, context) => {
  const path = event.path;
  const method = event.httpMethod;
  if (path.startsWith('/login')) return authHandler(event);
  if (path.startsWith('/order')) return orderHandler(event);
  if (path.startsWith('/customers')) return customerHandler(event);
  if (path.startsWith('/rewards')) return rewardHandler(event);
  if (path.startsWith('/coupons')) return couponHandler(event);
  if (path.startsWith('/dashboard')) return dashboardHandler(event);
  if (path.startsWith('/send-message')) return whatsappHandler(event);
  return {
    statusCode: 404,
    body: JSON.stringify({ message: 'Route not found' }),
  };
};
