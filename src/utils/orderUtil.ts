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

export const calculateTotalAmount = (items: Item[]): number => {
  return items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
};

export const buildOrderParams = (
  orderId: string,
  tableId: string,
  items: Item[],
  paymentDetails: PaymentDetails,
  timestamp: string,
  status: string = 'PENDING'
) => {
  const totalAmount = calculateTotalAmount(items);

  return {
    Item: {
      PK: `ORDER#${orderId}`,
      SK: 'DETAILS',
      orderId,
      tableId,
      items,
      totalAmount,
      paymentDetails,
      status,
      createdAt: timestamp,
    },
  };
};
