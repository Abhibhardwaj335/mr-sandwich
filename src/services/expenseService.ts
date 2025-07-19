import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const EXPENSE_PATH = '/expense';
const TABLE_NAME = 'EXPENSE_TABLE';
const EXPENSE_SK_PREFIX = 'EXPENSE#';
const RECORD_TYPE_EXPENSE = 'expense';

interface ExpenseRecord {
  PK: string;
  SK: string;
  recordType: string;
  restaurantId: string;
  category: string;
  description?: string;
  amount: number;
  date: string;
  paymentMethod: string;
  vendor?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);

  try {
    // POST /expense - Create a new expense
    if (httpMethod === 'POST' && path.includes(EXPENSE_PATH)) {
      const body = event.body ? JSON.parse(event.body) : {};
      const {
        restaurantId,
        category,
        description,
        amount,
        date,
        paymentMethod,
        vendor,
        notes
      } = body;

      // Validation
      if (!restaurantId || !category || !amount || !date || !paymentMethod) {
        return error({ message: "Missing required fields: restaurantId, category, amount, date, paymentMethod" }, 400);
      }

      if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return error({ message: "Amount must be a valid positive number" }, 400);
      }

      // Generate unique expense ID using timestamp and random suffix
      const expenseId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const timestamp = new Date().toISOString();

      const expenseData: ExpenseRecord = {
        PK: `RESTAURANT#${restaurantId}`,
        SK: `${EXPENSE_SK_PREFIX}${date}#${expenseId}`,
        recordType: RECORD_TYPE_EXPENSE,
        restaurantId,
        category,
        description: description || '',
        amount: parseFloat(amount),
        date,
        paymentMethod,
        vendor: vendor || '',
        notes: notes || '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await dynamo.put({
          TableName: TABLE_NAME,
          Item: expenseData,
        }).promise();

        console.log("✅ Expense saved:", expenseData);
        return success(201, {
          message: "Expense saved successfully",
          expenseId,
          expense: expenseData
        });
      } catch (err) {
        return handleError("saving expense:", err);
      }
    }

    // GET /expense - Fetch expenses with optional filters
    if (httpMethod === 'GET' && path.includes(EXPENSE_PATH)) {
      const queryParams = event.queryStringParameters || {};
      const { restaurantId, date, startDate, endDate, category } = queryParams;

      if (!restaurantId) {
        return error({ message: "Missing required parameter: restaurantId" }, 400);
      }

      try {
        let queryExpression: any = {
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `RESTAURANT#${restaurantId}`,
          },
        };

        // Filter by specific date
        if (date) {
          queryExpression.KeyConditionExpression += ' AND begins_with(SK, :sk)';
          queryExpression.ExpressionAttributeValues[':sk'] = `${EXPENSE_SK_PREFIX}${date}`;
        }
        // Filter by date range
        else if (startDate && endDate) {
          queryExpression.KeyConditionExpression += ' AND SK BETWEEN :startSK AND :endSK';
          queryExpression.ExpressionAttributeValues[':startSK'] = `${EXPENSE_SK_PREFIX}${startDate}`;
          queryExpression.ExpressionAttributeValues[':endSK'] = `${EXPENSE_SK_PREFIX}${endDate}#zzz`;
        }
        // Filter for expenses only (not other record types)
        else {
          queryExpression.KeyConditionExpression += ' AND begins_with(SK, :sk)';
          queryExpression.ExpressionAttributeValues[':sk'] = EXPENSE_SK_PREFIX;
        }

        // Add category filter if specified
        if (category) {
          queryExpression.FilterExpression = 'category = :category';
          queryExpression.ExpressionAttributeValues[':category'] = category;
        }

        const result = await dynamo.query(queryExpression).promise();

        let expenses = result.Items || [];

        // Calculate totals
        const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        const expenseCount = expenses.length;

        // Sort by date and time (newest first)
        expenses.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return success(200, {
          expenses,
          summary: {
            totalAmount: parseFloat(totalAmount.toFixed(2)),
            expenseCount,
            dateRange: startDate && endDate ? { startDate, endDate } : null,
            specificDate: date || null,
            category: category || null
          }
        });
      } catch (err) {
        return handleError("fetching expenses:", err);
      }
    }

    // PUT /expense - Update an existing expense
    if (httpMethod === 'PUT' && path.includes(EXPENSE_PATH)) {
      const body = event.body ? JSON.parse(event.body) : {};
      const {
        restaurantId,
        expenseId,
        originalDate,
        category,
        description,
        amount,
        date,
        paymentMethod,
        vendor,
        notes
      } = body;

      if (!restaurantId || !expenseId || !originalDate) {
        return error({ message: "Missing required fields: restaurantId, expenseId, originalDate" }, 400);
      }

      if (amount && (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)) {
        return error({ message: "Amount must be a valid positive number" }, 400);
      }

      try {
        const originalSK = `${EXPENSE_SK_PREFIX}${originalDate}#${expenseId}`;

        // First, get the existing expense
        const getResult = await dynamo.get({
          TableName: TABLE_NAME,
          Key: {
            PK: `RESTAURANT#${restaurantId}`,
            SK: originalSK,
          },
        }).promise();

        if (!getResult.Item) {
          return error({ message: "Expense not found" }, 404);
        }

        const existingExpense = getResult.Item as ExpenseRecord;

        // Prepare updated data
        const updatedExpense: ExpenseRecord = {
          ...existingExpense,
          category: category || existingExpense.category,
          description: description !== undefined ? description : existingExpense.description,
          amount: amount ? parseFloat(amount) : existingExpense.amount,
          date: date || existingExpense.date,
          paymentMethod: paymentMethod || existingExpense.paymentMethod,
          vendor: vendor !== undefined ? vendor : existingExpense.vendor,
          notes: notes !== undefined ? notes : existingExpense.notes,
          updatedAt: new Date().toISOString(),
        };

        // If date changed, we need to delete old record and create new one (SK includes date)
        if (date && date !== originalDate) {
          const newSK = `${EXPENSE_SK_PREFIX}${date}#${expenseId}`;
          updatedExpense.SK = newSK;

          // Delete old record
          await dynamo.delete({
            TableName: TABLE_NAME,
            Key: {
              PK: `RESTAURANT#${restaurantId}`,
              SK: originalSK,
            },
          }).promise();

          // Create new record with updated date
          await dynamo.put({
            TableName: TABLE_NAME,
            Item: updatedExpense,
          }).promise();
        } else {
          // Update existing record in place
          await dynamo.put({
            TableName: TABLE_NAME,
            Item: updatedExpense,
          }).promise();
        }

        console.log("✅ Expense updated:", updatedExpense);
        return success(200, {
          message: "Expense updated successfully",
          expense: updatedExpense
        });
      } catch (err) {
        return handleError("updating expense:", err);
      }
    }

    // DELETE /expense - Delete an expense
    if (httpMethod === 'DELETE' && path.includes(EXPENSE_PATH)) {
      const queryParams = event.queryStringParameters || {};
      const { restaurantId, expenseId, date } = queryParams;

      if (!restaurantId || !expenseId || !date) {
        return error({ message: "Missing required parameters: restaurantId, expenseId, date" }, 400);
      }

      try {
        const sk = `${EXPENSE_SK_PREFIX}${date}#${expenseId}`;

        // First check if expense exists
        const getResult = await dynamo.get({
          TableName: TABLE_NAME,
          Key: {
            PK: `RESTAURANT#${restaurantId}`,
            SK: sk,
          },
        }).promise();

        if (!getResult.Item) {
          return error({ message: "Expense not found" }, 404);
        }

        // Delete the expense
        await dynamo.delete({
          TableName: TABLE_NAME,
          Key: {
            PK: `RESTAURANT#${restaurantId}`,
            SK: sk,
          },
        }).promise();

        console.log("✅ Expense deleted:", { restaurantId, expenseId, date });
        return success(200, {
          message: "Expense deleted successfully",
          deletedExpense: { restaurantId, expenseId, date }
        });
      } catch (err) {
        return handleError("deleting expense:", err);
      }
    }

    // GET /expense/summary - Get expense summary and analytics
    if (httpMethod === 'GET' && path.includes('/expense/summary')) {
      const queryParams = event.queryStringParameters || {};
      const { restaurantId, startDate, endDate } = queryParams;

      if (!restaurantId) {
        return error({ message: "Missing required parameter: restaurantId" }, 400);
      }

      try {
        let queryExpression: any = {
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `RESTAURANT#${restaurantId}`,
            ':sk': EXPENSE_SK_PREFIX,
          },
        };

        // Add date range filter if provided
        if (startDate && endDate) {
          queryExpression.KeyConditionExpression = 'PK = :pk AND SK BETWEEN :startSK AND :endSK';
          queryExpression.ExpressionAttributeValues[':startSK'] = `${EXPENSE_SK_PREFIX}${startDate}`;
          queryExpression.ExpressionAttributeValues[':endSK'] = `${EXPENSE_SK_PREFIX}${endDate}#zzz`;
        }

        const result = await dynamo.query(queryExpression).promise();
        const expenses = result.Items || [];

        // Calculate summary statistics
        const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        const expenseCount = expenses.length;

        // Group by category
        const categoryTotals = expenses.reduce((acc, expense) => {
          acc[expense.category] = (acc[expense.category] || 0) + expense.amount;
          return acc;
        }, {} as Record<string, number>);

        // Group by payment method
        const paymentMethodTotals = expenses.reduce((acc, expense) => {
          acc[expense.paymentMethod] = (acc[expense.paymentMethod] || 0) + expense.amount;
          return acc;
        }, {} as Record<string, number>);

        // Group by date for daily totals
        const dailyTotals = expenses.reduce((acc, expense) => {
          acc[expense.date] = (acc[expense.date] || 0) + expense.amount;
          return acc;
        }, {} as Record<string, number>);

        // Calculate averages
        const uniqueDates = Object.keys(dailyTotals);
        const averageDailyExpense = uniqueDates.length > 0 ? totalAmount / uniqueDates.length : 0;
        const averageExpenseAmount = expenseCount > 0 ? totalAmount / expenseCount : 0;

        // Find highest expense categories
        const sortedCategories = Object.entries(categoryTotals)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5);

        return success(200, {
          summary: {
            totalAmount: parseFloat(totalAmount.toFixed(2)),
            expenseCount,
            averageDailyExpense: parseFloat(averageDailyExpense.toFixed(2)),
            averageExpenseAmount: parseFloat(averageExpenseAmount.toFixed(2)),
            dateRange: startDate && endDate ? { startDate, endDate } : null,
            uniqueDays: uniqueDates.length,
          },
          categoryBreakdown: Object.fromEntries(
            Object.entries(categoryTotals).map(([cat, amt]) => [cat, parseFloat(amt.toFixed(2))])
          ),
          paymentMethodBreakdown: Object.fromEntries(
            Object.entries(paymentMethodTotals).map(([method, amt]) => [method, parseFloat(amt.toFixed(2))])
          ),
          dailyTotals: Object.fromEntries(
            Object.entries(dailyTotals).map(([date, amt]) => [date, parseFloat(amt.toFixed(2))])
          ),
          topCategories: sortedCategories.map(([category, amount]) => ({
            category,
            amount: parseFloat(amount.toFixed(2)),
            percentage: parseFloat(((amount / totalAmount) * 100).toFixed(1))
          }))
        });
      } catch (err) {
        return handleError("fetching expense summary:", err);
      }
    }

    return error({ message: "Method not supported or invalid path" }, 405);

  } catch (err: unknown) {
    return handleError("🔥 Error in expense service:", err);
  }
};

function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  const timestamp = date.getTime();

  if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) return false;

  return dateString === date.toISOString().split('T')[0];
}