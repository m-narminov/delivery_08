import type { Order, OrderEvent, OrderList, OrderListQuery } from '@foodster/shared';
import type { Database } from '../../db/client';
import { notFound } from '../../errors';
import { toOrderDto, toOrderEventDto } from './orders.mapper';
import * as repository from './orders.repository';

export async function listOrders(db: Database, query: OrderListQuery): Promise<OrderList> {
  const { rows, total } = await repository.listOrders(db, query);
  return { items: rows.map(toOrderDto), total, page: query.page, pageSize: query.pageSize };
}

export async function getOrder(db: Database, id: number): Promise<Order> {
  const row = await repository.findOrderById(db, id);
  if (!row) throw notFound(`Заказ ${id} не найден`);
  return toOrderDto(row);
}

// Существование заказа проверяется, только если истории нет: у каждого заказа есть хотя бы
// запись о создании, так что обычно это один запрос вместо двух.
export async function getOrderEvents(db: Database, id: number): Promise<OrderEvent[]> {
  const rows = await repository.listOrderEvents(db, id);
  if (rows.length === 0 && !(await repository.orderExists(db, id))) {
    throw notFound(`Заказ ${id} не найден`);
  }
  return rows.map(toOrderEventDto);
}
