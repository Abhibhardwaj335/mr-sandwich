import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';

export const handler = async (event) => {
  const method = event.httpMethod;

  try {
    if (method === "POST" && path.includes("/login")) {
        const { username, password } = JSON.parse(event.body);
        const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
        const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
          return response(200, { success: true });
        } else {
          return response(401, { success: false, message: "Invalid credentials" });
        }
    }
    return error('Method not supported', 405);
  } catch (err) {
    return error(err.message);
  }
};
