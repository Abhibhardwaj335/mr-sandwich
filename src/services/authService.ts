import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo, TABLE_NAME } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

export const handler = async (event: APIGatewayEvent, context: Context) => {  // Added Context as the second parameter
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);
  try {
    if (httpMethod === "POST" && path.includes("/login")) {
      const { username, password } = event.body ? JSON.parse(event.body) : {};
      const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
      const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

      if (!username || !password) {
        return error({ message: "Missing username or password" }, 400);
      }

      if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return success(200, { success: true });
      } else {
        return error({ message: "Invalid credentials" }, 401);
      }
    }
    return error({ message: "Method not supported" }, 405);
  } catch (err: unknown) {
    return handleError("during login:", err);
  }
};
