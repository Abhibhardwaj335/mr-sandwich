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
  total: string,
  timestamp: string,
  status: string = 'PENDING',
  name: string,
  phoneNumber: string
) => {
  const totalAmount = (total !== undefined && total !== null) ? total : calculateTotalAmount(items);

  return {
    Item: {
      PK: `ORDER#${orderId}`,
      SK: 'ORDER_DETAILS',
      recordType: 'order',
      orderId,
      tableId,
      name,
      phoneNumber,
      items,
      totalAmount,
      paymentDetails,
      status,
      createdAt: timestamp,
    },
  };
};
