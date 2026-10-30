export type ShippingProviderError = Error & {
  readonly isShippingProviderError: true
  readonly status?: number
}

export function isShippingProviderError(error: unknown): error is ShippingProviderError {
  return error instanceof Error && (error as Partial<ShippingProviderError>).isShippingProviderError === true
}
