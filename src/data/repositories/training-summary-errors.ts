export function generationErrorMessage(code: string): string {
  if (code === 'no_completed_workouts') return 'За выбранный период нет завершённых тренировок.'
  if (code === 'source_row_limit_reached') return 'Для этого периода слишком много данных. Выберите меньший период.'
  if (code === 'yandex_cloud_invalid_summary') return 'Не получилось подготовить полный анализ. Попробуйте ещё раз.'
  if (code === 'yandex_cloud_invalid_json') return 'Не получилось обработать анализ. Попробуйте ещё раз.'
  if (code === 'yandex_cloud_quality_check_failed') {
    return 'Не получилось проверить качество анализа. Попробуйте ещё раз.'
  }
  if (code === 'yandex_cloud_rate_limited' || code === 'yandex_cloud_unavailable' || code === 'yandex_cloud_timeout') {
    return 'Не получилось создать анализ. Попробуйте ещё раз через минуту.'
  }
  if (code === 'yandex_cloud_access_rejected') {
    return 'Сервис анализа временно недоступен. Попробуйте ещё раз позже.'
  }
  if (code === 'yandex_cloud_request_rejected' || code.startsWith('yandex_cloud_error_')) {
    return 'Не получилось обработать данные для анализа. Попробуйте ещё раз позже.'
  }
  if (code === 'summary_save_failed' || code === 'summary_visibility_save_failed') {
    return 'Анализ создан, но не сохранился. Попробуйте ещё раз.'
  }
  if (code === 'client_goal_lookup_failed') {
    return 'Не удалось получить цель клиента для анализа. Повторите обновление.'
  }
  if (code === 'first_workout_lookup_failed' || code === 'workouts_lookup_failed') {
    return 'Не удалось получить завершённые тренировки для анализа. Повторите обновление.'
  }
  if (code === 'exercises_lookup_failed' || code === 'sets_lookup_failed') {
    return 'Не удалось получить результаты упражнений для анализа. Повторите обновление.'
  }
  if (code === 'summary_cache_lookup_failed') {
    return 'Не удалось проверить предыдущий анализ. Повторите обновление.'
  }
  if (code === 'internal_error') {
    return 'Не получилось подготовить анализ. Попробуйте обновить его позже.'
  }
  return 'Не удалось обновить анализ.'
}
