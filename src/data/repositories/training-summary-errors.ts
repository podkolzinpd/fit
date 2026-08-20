export function generationErrorMessage(code: string): string {
  if (code === 'no_completed_workouts') return 'За выбранный период нет завершённых тренировок.'
  if (code === 'source_row_limit_reached') return 'Для этого периода слишком много данных. Выберите меньший период.'
  if (code === 'yandex_cloud_invalid_summary') return 'Модель вернула неполную суммаризацию. Попробуйте ещё раз.'
  if (code === 'yandex_cloud_invalid_json') return 'Модель вернула ответ в неожиданном формате. Попробуйте ещё раз.'
  if (code === 'yandex_cloud_quality_check_failed') {
    return 'Модель не прошла автоматическую проверку качества. Попробуйте ещё раз.'
  }
  if (code.startsWith('yandex_cloud_error_')) {
    return 'YandexGPT временно не принял запрос. Проверьте настройки модели и повторите позже.'
  }
  if (code === 'yandex_cloud_unavailable' || code === 'yandex_cloud_timeout') {
    return 'YandexGPT временно недоступен. Попробуйте ещё раз через минуту.'
  }
  if (code === 'summary_save_failed' || code === 'summary_visibility_save_failed') {
    return 'Сводка сформирована, но не сохранилась в Supabase. Проверьте права таблиц и повторите.'
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
    return 'Сервер не смог подготовить ИИ-анализ. Ошибка уже отмечена; повторите обновление позже.'
  }
  return 'Не удалось обновить ИИ-анализ.'
}
