import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  listAccountOrders,
  retrieveAccountCustomer,
  type AccountOrder,
  type OrderFilter,
  type OrderSort,
} from "./utils"

type AccountOrdersResponse = {
  orders: AccountOrder[]
  count: number
}

const PAGE_SIZE = 10

function parseFilter(value: unknown): OrderFilter {
  return value === "in_progress" || value === "history" ? value : "all"
}

function parseSort(value: unknown): OrderSort {
  return value === "created_at_asc" ? "created_at_asc" : "created_at_desc"
}

function parseOffset(value: unknown): number {
  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse<AccountOrdersResponse>
) {
  const customer = await retrieveAccountCustomer(req)

  // Filter, sort and offset are independent: changing one must not silently
  // change another. In particular the page size no longer depends on whether a
  // filter was given — "all" is paged like any other view.
  const { orders, count } = await listAccountOrders(req.scope, customer, {
    filter: parseFilter(req.query.filter),
    sort: parseSort(req.query.sort),
    limit: PAGE_SIZE,
    offset: parseOffset(req.query.offset),
  })

  res.status(200).json({ orders, count })
}
