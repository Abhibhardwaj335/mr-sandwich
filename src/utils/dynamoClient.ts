import AWS from 'aws-sdk';

const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.CUSTOMER_TABLE as string;

if (!TABLE_NAME) {
  throw new Error('Environment variable CUSTOMER_TABLE is not set');
}

export { dynamo, TABLE_NAME };
