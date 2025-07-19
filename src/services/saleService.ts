import { APIGatewayEvent, Context } from 'aws-lambda';
import { dynamo } from '../utils/dynamoClient';
import { success, error } from '../utils/response';
import { handleError } from '../utils/errorHandler';

const SALE_PATH = '/sale';
const TABLE_NAME = 'SALE_TABLE';
const SALE_SK_PREFIX = 'SALE#';
const RECORD_TYPE_SALE = 'sale';

interface SaleRecord {
  PK: string;
  SK: string;
  recordType: string;
  restaurantId: string;
  itemName: string;
  category: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  date: string;
  paymentMethod: string;
  customerName?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const handler = async (event: APIGatewayEvent, context: Context) => {
  const { path, httpMethod } = event;
  console.log(`Processing request - Path: ${path}, Method: ${httpMethod}`);

  try {
    // POST /sale - Create a new sale
    if (httpMethod === 'POST' && path.includes(SALE_PATH)) {
      const body = event.body ? JSON.parse(event.body) : {};
      const {
        restaurantId,
        itemName,
        category,
        quantity,
        unitPrice,
        date,
        paymentMethod,
        customerName,
        notes
      } = body;

      // Validation
      if (!restaurantId || !itemName || !category || !quantity || !unitPrice || !date || !paymentMethod) {
        return error({ message: "Missing required fields: restaurantId, itemName, category, quantity, unitPrice, date, paymentMethod" }, 400);
      }

      if (isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
        return error({ message: "Quantity must be a valid positive number" }, 400);
      }

      if (isNaN(parseFloat(unitPrice)) || parseFloat(unitPrice) <= 0) {
        return error({ message: "Unit price must be a valid positive number" }, 400);
      }

      if (!isValidDate(date)) {
        return error({ message: "Date must be in YYYY-MM-DD format" }, 400);
      }

      // Generate unique sale ID using timestamp and random suffix
      const saleId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const timestamp = new Date().toISOString();
      const parsedQuantity = parseFloat(quantity);
      const parsedUnitPrice = parseFloat(unitPrice);
      const totalAmount = parsedQuantity * parsedUnitPrice;

      const saleData: SaleRecord = {
        PK: `RESTAURANT#${restaurantId}`,
        SK: `${SALE_SK_PREFIX}${date}#${saleId}`,
        recordType: RECORD_TYPE_SALE,
        restaurantId,
        itemName,
        category,
        quantity: parsedQuantity,
        unitPrice: parsedUnitPrice,
        totalAmount,
        date,
        paymentMethod,
        customerName: customerName || '',
        notes: notes || '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        await dynamo.put({
          TableName: TABLE_NAME,
          Item: saleData,
        }).promise();

        console.log("✅ Sale saved:", saleData);
        return success(201, {
          message: "Sale saved successfully",
          saleId,
          sale: saleData
        });
      } catch (err) {
        return handleError("saving sale:", err);
      }
    }

    // GET /sale - Fetch sales with optional filters
    if (httpMethod === 'GET' && path.includes(SALE_PATH)) {
      const queryParams = event.queryStringParameters || {};
      const { restaurantId, date, startDate, endDate, category, itemName, paymentMethod } = queryParams;

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
          queryExpression.ExpressionAttributeValues[':sk'] = `${SALE_SK_PREFIX}${date}`;
        }
        // Filter by date range
        else if (startDate && endDate) {
          queryExpression.KeyConditionExpression += ' AND SK BETWEEN :startSK AND :endSK';
          queryExpression.ExpressionAttributeValues[':startSK'] = `${SALE_SK_PREFIX}${startDate}`;
          queryExpression.ExpressionAttributeValues[':endSK'] = `${SALE_SK_PREFIX}${endDate}#zzz`;
        }
        // Filter for sales only (not other record types)
        else {
          queryExpression.KeyConditionExpression += ' AND begins_with(SK, :sk)';
          queryExpression.ExpressionAttributeValues[':sk'] = SALE_SK_PREFIX;
        }

        // Build filter expressions for additional filters
        const filterExpressions = [];
        if (category) {
          filterExpressions.push('category = :category');
          queryExpression.ExpressionAttributeValues[':category'] = category;
        }
        if (itemName) {
          filterExpressions.push('contains(itemName, :itemName)');
          queryExpression.ExpressionAttributeValues[':itemName'] = itemName;
        }
        if (paymentMethod) {
          filterExpressions.push('paymentMethod = :paymentMethod');
          queryExpression.ExpressionAttributeValues[':paymentMethod'] = paymentMethod;
        }

        if (filterExpressions.length > 0) {
          queryExpression.FilterExpression = filterExpressions.join(' AND ');
        }

        const result = await dynamo.query(queryExpression).promise();

        let sales = result.Items || [];

        // Calculate totals
        const totalRevenue = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
        const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
        const saleCount = sales.length;

        // Sort by date and time (newest first)
        sales.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return success(200, {
          sales,
          summary: {
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            totalQuantity: parseFloat(totalQuantity.toFixed(2)),
            saleCount,
            averageOrderValue: saleCount > 0 ? parseFloat((totalRevenue / saleCount).toFixed(2)) : 0,
            dateRange: startDate && endDate ? { startDate, endDate } : null,
            specificDate: date || null,
            filters: {
              category: category || null,
              itemName: itemName || null,
              paymentMethod: paymentMethod || null
            }
          }
        });
      } catch (err) {
        return handleError("fetching sales:", err);
      }
    }

    // PUT /sale - Update an existing sale
    if (httpMethod === 'PUT' && path.includes(SALE_PATH)) {
      const body = event.body ? JSON.parse(event.body) : {};
      const {
        restaurantId,
        saleId,
        originalDate,
        itemName,
        category,
        quantity,
        unitPrice,
        date,
        paymentMethod,
        customerName,
        notes
      } = body;

      if (!restaurantId || !saleId || !originalDate) {
        return error({ message: "Missing required fields: restaurantId, saleId, originalDate" }, 400);
      }

      if (quantity && (isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0)) {
        return error({ message: "Quantity must be a valid positive number" }, 400);
      }

      if (unitPrice && (isNaN(parseFloat(unitPrice)) || parseFloat(unitPrice) <= 0)) {
        return error({ message: "Unit price must be a valid positive number" }, 400);
      }

      if (date && !isValidDate(date)) {
        return error({ message: "Date must be in YYYY-MM-DD format" }, 400);
      }

      try {
        const originalSK = `${SALE_SK_PREFIX}${originalDate}#${saleId}`;

        // First, get the existing sale
        const getResult = await dynamo.get({
          TableName: TABLE_NAME,
          Key: {
            PK: `RESTAURANT#${restaurantId}`,
            SK: originalSK,
          },
        }).promise();

        if (!getResult.Item) {
          return error({ message: "Sale not found" }, 404);
        }

        const existingSale = getResult.Item as SaleRecord;

        // Prepare updated data
        const updatedQuantity = quantity ? parseFloat(quantity) : existingSale.quantity;
        const updatedUnitPrice = unitPrice ? parseFloat(unitPrice) : existingSale.unitPrice;
        const updatedTotalAmount = updatedQuantity * updatedUnitPrice;

        const updatedSale: SaleRecord = {
          ...existingSale,
          itemName: itemName || existingSale.itemName,
          category: category || existingSale.category,
          quantity: updatedQuantity,
          unitPrice: updatedUnitPrice,
          totalAmount: updatedTotalAmount,
          date: date || existingSale.date,
          paymentMethod: paymentMethod || existingSale.paymentMethod,
          customerName: customerName !== undefined ? customerName : existingSale.customerName,
          notes: notes !== undefined ? notes : existingSale.notes,
          updatedAt: new Date().toISOString(),
        };

        // If date changed, we need to delete old record and create new one (SK includes date)
        if (date && date !== originalDate) {
          const newSK = `${SALE_SK_PREFIX}${date}#${saleId}`;
          updatedSale.SK = newSK;

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
            Item: updatedSale,
          }).promise();
        } else {
          // Update existing record in place
          await dynamo.put({
            TableName: TABLE_NAME,
            Item: updatedSale,
          }).promise();
        }

        console.log("✅ Sale updated:", updatedSale);
        return success(200, {
          message: "Sale updated successfully",
          sale: updatedSale
        });
      } catch (err) {
        return handleError("updating sale:", err);
      }
    }

    // DELETE /sale - Delete a sale
    if (httpMethod === 'DELETE' && path.includes(SALE_PATH)) {
      const queryParams = event.queryStringParameters || {};
      const { restaurantId, saleId, date } = queryParams;

      if (!restaurantId || !saleId || !date) {
        return error({ message: "Missing required parameters: restaurantId, saleId, date" }, 400);
      }

      try {
        const sk = `${SALE_SK_PREFIX}${date}#${saleId}`;

        // First check if sale exists
        const getResult = await dynamo.get({
          TableName: TABLE_NAME,
          Key: {
            PK: `RESTAURANT#${restaurantId}`,
            SK: sk,
          },
        }).promise();

        if (!getResult.Item) {
          return error({ message: "Sale not found" }, 404);
        }

        // Delete the sale
        await dynamo.delete({
          TableName: TABLE_NAME,
          Key: {
            PK: `RESTAURANT#${restaurantId}`,
            SK: sk,
          },
        }).promise();

        console.log("✅ Sale deleted:", { restaurantId, saleId, date });
        return success(200, {
          message: "Sale deleted successfully",
          deletedSale: { restaurantId, saleId, date }
        });
      } catch (err) {
        return handleError("deleting sale:", err);
      }
    }

    // GET /sale/summary - Get sales summary and analytics
    if (httpMethod === 'GET' && path.includes('/sale/summary')) {
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
            ':sk': SALE_SK_PREFIX,
          },
        };

        // Add date range filter if provided
        if (startDate && endDate) {
          queryExpression.KeyConditionExpression = 'PK = :pk AND SK BETWEEN :startSK AND :endSK';
          queryExpression.ExpressionAttributeValues[':startSK'] = `${SALE_SK_PREFIX}${startDate}`;
          queryExpression.ExpressionAttributeValues[':endSK'] = `${SALE_SK_PREFIX}${endDate}#zzz`;
        }

        const result = await dynamo.query(queryExpression).promise();
        const sales = result.Items || [];

        // Calculate summary statistics
        const totalRevenue = sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
        const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
        const saleCount = sales.length;

        // Group by category
        const categoryTotals = sales.reduce((acc, sale) => {
          acc[sale.category] = (acc[sale.category] || 0) + sale.totalAmount;
          return acc;
        }, {} as Record<string, number>);

        // Group by item
        const itemTotals = sales.reduce((acc, sale) => {
          const key = sale.itemName;
          if (!acc[key]) {
            acc[key] = {
              revenue: 0,
              quantity: 0,
              count: 0,
              avgPrice: 0
            };
          }
          acc[key].revenue += sale.totalAmount;
          acc[key].quantity += sale.quantity;
          acc[key].count += 1;
          acc[key].avgPrice = acc[key].revenue / acc[key].quantity;
          return acc;
        }, {} as Record<string, {revenue: number, quantity: number, count: number, avgPrice: number}>);

        // Group by payment method
        const paymentMethodTotals = sales.reduce((acc, sale) => {
          acc[sale.paymentMethod] = (acc[sale.paymentMethod] || 0) + sale.totalAmount;
          return acc;
        }, {} as Record<string, number>);

        // Group by date for daily totals
        const dailyTotals = sales.reduce((acc, sale) => {
          if (!acc[sale.date]) {
            acc[sale.date] = {
              revenue: 0,
              quantity: 0,
              orderCount: 0
            };
          }
          acc[sale.date].revenue += sale.totalAmount;
          acc[sale.date].quantity += sale.quantity;
          acc[sale.date].orderCount += 1;
          return acc;
        }, {} as Record<string, {revenue: number, quantity: number, orderCount: number}>);

        // Calculate averages
        const uniqueDates = Object.keys(dailyTotals);
        const averageDailyRevenue = uniqueDates.length > 0 ? totalRevenue / uniqueDates.length : 0;
        const averageOrderValue = saleCount > 0 ? totalRevenue / saleCount : 0;

        // Find top performing items
        const sortedItems = Object.entries(itemTotals)
          .sort(([,a], [,b]) => b.revenue - a.revenue)
          .slice(0, 10);

        // Find top categories
        const sortedCategories = Object.entries(categoryTotals)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5);

        return success(200, {
          summary: {
            totalRevenue: parseFloat(totalRevenue.toFixed(2)),
            totalQuantity: parseFloat(totalQuantity.toFixed(2)),
            saleCount,
            averageDailyRevenue: parseFloat(averageDailyRevenue.toFixed(2)),
            averageOrderValue: parseFloat(averageOrderValue.toFixed(2)),
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
            Object.entries(dailyTotals).map(([date, data]) => [date, {
              revenue: parseFloat(data.revenue.toFixed(2)),
              quantity: parseFloat(data.quantity.toFixed(2)),
              orderCount: data.orderCount
            }])
          ),
          topCategories: sortedCategories.map(([category, amount]) => ({
            category,
            amount: parseFloat(amount.toFixed(2)),
            percentage: parseFloat(((amount / totalRevenue) * 100).toFixed(1))
          })),
          topItems: sortedItems.map(([itemName, data]) => ({
            itemName,
            revenue: parseFloat(data.revenue.toFixed(2)),
            quantity: parseFloat(data.quantity.toFixed(2)),
            orderCount: data.count,
            averagePrice: parseFloat(data.avgPrice.toFixed(2)),
            percentage: parseFloat(((data.revenue / totalRevenue) * 100).toFixed(1))
          }))
        });
      } catch (err) {
        return handleError("fetching sales summary:", err);
      }
    }

    // GET /sale/analytics - Get advanced sales analytics
    if (httpMethod === 'GET' && path.includes('/sale/analytics')) {
      const queryParams = event.queryStringParameters || {};
      const { restaurantId, startDate, endDate, groupBy = 'day' } = queryParams;

      if (!restaurantId) {
        return error({ message: "Missing required parameter: restaurantId" }, 400);
      }

      try {
        let queryExpression: any = {
          TableName: TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `RESTAURANT#${restaurantId}`,
            ':sk': SALE_SK_PREFIX,
          },
        };

        if (startDate && endDate) {
          queryExpression.KeyConditionExpression = 'PK = :pk AND SK BETWEEN :startSK AND :endSK';
          queryExpression.ExpressionAttributeValues[':startSK'] = `${SALE_SK_PREFIX}${startDate}`;
          queryExpression.ExpressionAttributeValues[':endSK'] = `${SALE_SK_PREFIX}${endDate}#zzz`;
        }

        const result = await dynamo.query(queryExpression).promise();
        const sales = result.Items || [];

        // Time-based analytics
        const timeBasedData = sales.reduce((acc, sale) => {
          let timeKey;
          const saleDate = new Date(sale.date);

          switch (groupBy) {
            case 'hour':
              timeKey = new Date(sale.createdAt).getHours().toString().padStart(2, '0') + ':00';
              break;
            case 'day':
              timeKey = sale.date;
              break;
            case 'week':
              const weekStart = new Date(saleDate);
              weekStart.setDate(saleDate.getDate() - saleDate.getDay());
              timeKey = weekStart.toISOString().split('T')[0];
              break;
            case 'month':
              timeKey = sale.date.substring(0, 7); // YYYY-MM
              break;
            default:
              timeKey = sale.date;
          }

          if (!acc[timeKey]) {
            acc[timeKey] = {
              revenue: 0,
              quantity: 0,
              orderCount: 0,
              items: {}
            };
          }

          acc[timeKey].revenue += sale.totalAmount;
          acc[timeKey].quantity += sale.quantity;
          acc[timeKey].orderCount += 1;

          // Track item performance within time period
          if (!acc[timeKey].items[sale.itemName]) {
            acc[timeKey].items[sale.itemName] = {
              quantity: 0,
              revenue: 0
            };
          }
          acc[timeKey].items[sale.itemName].quantity += sale.quantity;
          acc[timeKey].items[sale.itemName].revenue += sale.totalAmount;

          return acc;
        }, {} as Record<string, any>);

        // Calculate trends (comparing periods)
        const timeKeys = Object.keys(timeBasedData).sort();
        const trends = {
          revenueGrowth: 0,
          quantityGrowth: 0,
          orderCountGrowth: 0
        };

        if (timeKeys.length >= 2) {
          const latest = timeBasedData[timeKeys[timeKeys.length - 1]];
          const previous = timeBasedData[timeKeys[timeKeys.length - 2]];

          trends.revenueGrowth = previous.revenue > 0 ?
            parseFloat((((latest.revenue - previous.revenue) / previous.revenue) * 100).toFixed(2)) : 0;
          trends.quantityGrowth = previous.quantity > 0 ?
            parseFloat((((latest.quantity - previous.quantity) / previous.quantity) * 100).toFixed(2)) : 0;
          trends.orderCountGrowth = previous.orderCount > 0 ?
            parseFloat((((latest.orderCount - previous.orderCount) / previous.orderCount) * 100).toFixed(2)) : 0;
        }

        return success(200, {
          analytics: {
            groupBy,
            dateRange: startDate && endDate ? { startDate, endDate } : null,
            trends,
            timeBasedData: Object.fromEntries(
              Object.entries(timeBasedData).map(([time, data]: [string, any]) => [time, {
                revenue: parseFloat(data.revenue.toFixed(2)),
                quantity: parseFloat(data.quantity.toFixed(2)),
                orderCount: data.orderCount,
                averageOrderValue: parseFloat((data.revenue / data.orderCount).toFixed(2)),
                topItems: Object.entries(data.items)
                  .sort(([,a]: [string, any], [,b]: [string, any]) => b.revenue - a.revenue)
                  .slice(0, 3)
                  .map(([itemName, itemData]: [string, any]) => ({
                    itemName,
                    quantity: parseFloat(itemData.quantity.toFixed(2)),
                    revenue: parseFloat(itemData.revenue.toFixed(2))
                  }))
              }])
            )
          }
        });
      } catch (err) {
        return handleError("fetching sales analytics:", err);
      }
    }

    return error({ message: "Method not supported or invalid path" }, 405);

  } catch (err: unknown) {
    return handleError("🔥 Error in sale service:", err);
  }
};

// Utility function to validate date format (YYYY-MM-DD)
function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;

  const date = new Date(dateString);
  const timestamp = date.getTime();

  if (typeof timestamp !== 'number' || Number.isNaN(timestamp)) return false;

  return dateString === date.toISOString().split('T')[0];
}

// Example usage and API endpoints:
/*
POST /sale
Body: {
  "restaurantId": "MR_SANDWICH",
  "itemName": "Chicken Sandwich",
  "category": "Sandwiches",
  "quantity": 2,
  "unitPrice": 150.00,
  "date": "2025-06-07",
  "paymentMethod": "upi",
  "customerName": "John Doe",
  "notes": "Extra cheese and mayo"
}

GET /sale?restaurantId=MR_SANDWICH&date=2025-06-07
GET /sale?restaurantId=MR_SANDWICH&startDate=2025-06-01&endDate=2025-06-07
GET /sale?restaurantId=MR_SANDWICH&category=Sandwiches
GET /sale?restaurantId=MR_SANDWICH&itemName=Chicken&paymentMethod=upi

PUT /sale
Body: {
  "restaurantId": "MR_SANDWICH",
  "saleId": "1733472000000-abc123",
  "originalDate": "2025-06-07",
  "itemName": "Chicken Sandwich Deluxe",
  "quantity": 3,
  "unitPrice": 175.00,
  "date": "2025-06-07"
}

DELETE /sale?restaurantId=MR_SANDBOX&saleId=1733472000000-abc123&date=2025-06-07

GET /sale/summary?restaurantId=MR_SANDWICH&startDate=2025-06-01&endDate=2025-06-30

GET /sale/analytics?restaurantId=MR_SANDWICH&startDate=2025-06-01&endDate=2025-06-30&groupBy=day
GET /sale/analytics?restaurantId=MR_SANDWICH&groupBy=hour
*/