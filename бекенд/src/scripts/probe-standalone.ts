import { runMoyskladReadOnlyProbe } from "./probe-deep"

async function main() {
  console.log("Живой read-only прогон интеграции с МойСклад")
  console.log(
    "Операции записи НЕ проверяются: создание контрагента, заказа покупателя и пометки отмены."
  )

  const report = await runMoyskladReadOnlyProbe()

  if (report.missingVariables.length) {
    console.error(
      `НЕ ПРОШЛО | Реквизиты | задайте MOYSKLAD_TOKEN либо пару MOYSKLAD_LOGIN + MOYSKLAD_PASSWORD; отсутствуют: ${report.missingVariables.join(
        ", "
      )}`
    )
    process.exitCode = 1
    return
  }

  for (const result of report.results) {
    console.log(
      `${result.passed ? "ПРОШЛО" : "НЕ ПРОШЛО"} | ${result.name} | ${result.detail}`
    )
  }

  if (report.results.some((result) => !result.passed)) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(
    `НЕ ПРОШЛО | Прогон | ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
