import { Module } from "@medusajs/framework/utils"

import CartService from "./service"

export const CART_VERSIONING_MODULE = "cartVersioning"

export default Module(CART_VERSIONING_MODULE, {
  service: CartService,
})
