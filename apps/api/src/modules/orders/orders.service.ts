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

export async function getOrderEvents(db: Database, id: number): Promise<OrderEvent[]> {
  if (!(await repository.orderExists(db, id))) throw notFound(`Заказ ${id} не найден`);
  const rows = await repository.listOrderEvents(db, id);
  return rows.map(toOrderEventDto);
}
