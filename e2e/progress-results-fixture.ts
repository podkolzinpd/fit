import { mockWorkoutHistory } from './native-workout-fixture'
import { setFixture, exerciseFixture, workoutFixture } from './native-workout-fixture'
import { expect, type Page } from '@playwright/test';
const demoClientId = '11111111-1111-4111-8111-111111111111';
export function comparisonWorkoutRow(id: string, date: string, weight: number, distance: number, strengthSets: number) {
    const baseSet = (suffix: string, position: number, values: {
        weight?: number;
        reps?: number;
        distance?: number;
        duration?: number;
    }) => (setFixture({
        id: `${id}-${suffix}-${position}`, position,
        confirmedAt: `${date}T10:00:00Z`, version: 1,
        plan: { weightKg: values.weight ?? null, reps: values.reps ?? null, durationMin: values.duration ?? null, durationSec: null, distanceKm: values.distance ?? null, rpe: null },
        fact: { weightKg: values.weight ?? null, reps: values.reps ?? null, durationMin: values.duration ?? null, durationSec: null, distanceKm: values.distance ?? null, rpe: null }
    }));
    const exercise = (suffix: string, name: string, muscle: Parameters<typeof exerciseFixture>[0]['muscleGroup'], kind: Parameters<typeof exerciseFixture>[0]['inputKind'], sets: ReturnType<typeof baseSet>[]) => (exerciseFixture({
        id: `${id}-${suffix}`, position: suffix === 'press' ? 0 : 1, source: 'system', ref: suffix,
        customExerciseId: null, name: name, muscleGroup: muscle, inputKind: kind, blockId: `${id}-${suffix}-block`,
        blockType: 'single', blockPreset: 'set', blockRounds: 1, restBetweenExercisesSec: 0,
        restBetweenRoundsSec: 0, restBetweenSetsSec: 60, trainerComment: null, sets
    }));
    return workoutFixture({
        id, clientId: demoClientId, trainerId: '00000000-0000-4000-8000-000000000001', clientName: 'Анна Смирнова', createdBy: null,
        workoutDate: date, startTime: null, endTime: null, startedAt: `${date}T09:00:00Z`, completedAt: `${date}T10:00:00Z`,
        status: 'done', notes: null, trainerReview: null, trainerReaction: null, trainerReviewAuthorId: null,
        trainerReviewedAt: null, clientComment: null, sessionRpe: null, wellbeing: null, discomfort: null, hasPr: false,
        stageId: null, stageTitle: null, version: 1,
        exercises: [
            exercise('press', 'Жим лёжа', 'chest', 'strength', Array.from({ length: strengthSets }, (_, index) => baseSet('press-set', index, { weight, reps: 10 }))),
            exercise('run', 'Бег', 'cardio', 'distance', [baseSet('run-set', 0, { distance, duration: 30 })]),
        ]
    });
}
export async function mockResultsHistory(page: Page) {
    const rows = [
        comparisonWorkoutRow('c1000000-0000-4000-8000-000000000001', '2026-07-01', 40, 3, 1),
        comparisonWorkoutRow('c1000000-0000-4000-8000-000000000002', '2026-08-03', 50, 5, 1),
        comparisonWorkoutRow('c1000000-0000-4000-8000-000000000003', '2026-08-10', 45, 4, 1),
        comparisonWorkoutRow('c1000000-0000-4000-8000-000000000004', '2026-08-12', 50, 5, 2),
    ];
    const last = rows[3]!;
    last.exercises[0]!.sets[0]!.fact.reps = 12;
    const unknown = structuredClone(last.exercises[0]!);
    Object.assign(unknown, { id: `${last.id}-unknown`, position: 2, ref: 'unmapped-zone', name: 'Свободное движение', muscleGroup: 'other', inputKind: 'reps', blockId: `${last.id}-unknown-block` });
    unknown.sets = [setFixture({ ...unknown.sets[0]!, id: `${last.id}-unknown-set`, plan: { weightKg: null }, fact: { weightKg: null } })];
    last.exercises.push(unknown);
    await mockWorkoutHistory(page, rows)
}
export async function verifyAnalysisShortcutKeepsShell(page: Page) {
    const preview = page.getByLabel('ИИ-анализ за период');
    const trigger = page.getByRole('button', { name: 'Открыть анализ' });
    await expect(preview).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    if (!await trigger.count()) {
        await expect(page.locator('.client-tab-bar')).toBeInViewport();
        return;
    }
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Подробный анализ' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.client-tab-bar')).toBeInViewport();
    await expect(page.locator('.client-tab-bar').evaluate((tabBar) => {
        const rect = tabBar.getBoundingClientRect();
        return {
            rootScroll: Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop),
            staysAtBottom: rect.top > window.innerHeight / 2 && rect.bottom <= window.innerHeight
        };
    })).resolves.toEqual({ rootScroll: 0, staysAtBottom: true });
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(trigger).toBeFocused();
}
export async function verifyResultsSources(page: Page) {
    const center = page.locator('#results-center');
    await verifyAnalysisShortcutKeepsShell(page);
    await page.getByRole('tab', { name: 'ПРО' }).click();
    // Both panels stay mounted. Wait for the tab commit before collecting visible
    // controls, otherwise the old overview can become hidden during measurement.
    await expect(page.getByRole('tabpanel', { name: 'ПРО', exact: true })).toBeVisible();
    await expect(page.locator('.progress-pro-list #results-center')).toHaveCount(1);
    // DOM presence can precede WebKit's layout after the tab switch. Keep the
    // nonempty/all-targets >=44px contract, but wait within the normal assertion
    // budget instead of inspecting an intermediate zero-height render once.
    await expect.poll(async () => {
        const heights = await page.locator('.progress-details-toggle:visible').evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
        return heights.length > 0 && heights.every((height) => height >= 44);
    }, { message: 'Visible progress controls settle at their required 44px minimum' }).toBe(true);
    await expect(center).not.toHaveAttribute('open');
    await expect(page.locator('.weekly-training-load')).not.toHaveAttribute('open');
    await center.getByText('Все результаты', { exact: true }).click();
    await center.scrollIntoViewIfNeeded();
    await page.locator('.content').evaluate((element) => {
        element.scrollTop = Math.min(element.scrollTop + 120, element.scrollHeight - element.clientHeight);
    });
    const scrollBeforeFilters = await page.locator('.content').evaluate((element) => element.scrollTop);
    expect(scrollBeforeFilters).toBeGreaterThan(0);
    await center.getByRole('combobox', { name: 'Упражнение', exact: true }).selectOption('system:press:strength');
    await expect(page).toHaveURL(/resultExercise=system%3Apress%3Astrength/);
    await expect(page.locator('.content').evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(0);
    await center.getByRole('combobox', { name: 'Показатель', exact: true }).selectOption('weight');
    await expect(page).toHaveURL(/resultMetric=weight/);
    await expect(page.locator('.content').evaluate((element) => element.scrollTop)).resolves.toBeGreaterThan(0);
    for (const field of await center.getByRole('combobox').all())
        expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const resultRows = center.locator('.center-result-row');
    await expect(resultRows).toHaveCount(3);
    const record = resultRows.filter({ hasText: 'Личный рекорд' });
    await expect(record).toHaveCount(1);
    await expect(resultRows.filter({ hasText: 'Результат снизился' })).toHaveCount(1);
    await record.getByRole('link', { name: 'Ранее · 1 июля 2026 г.' }).click();
    await expect(page).toHaveURL(/workouts\/c1000000-0000-4000-8000-000000000001$/);
    await expect(page.locator('.workout-detail-page')).toBeVisible();
    await expect(page.locator('.workout-detail-page').getByRole('article').getByText('Жим лёжа', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await expect(page).toHaveURL(/resultExercise=system%3Apress%3Astrength.*resultMetric=weight/);
    await expect(center).toHaveAttribute('open');
    await expect(center.getByRole('combobox', { name: 'Упражнение', exact: true })).toHaveValue('system:press:strength');
    await expect(center.getByRole('combobox', { name: 'Показатель', exact: true })).toHaveValue('weight');
    await expect(page).toHaveURL(/#results-center$/);
    await expect(center).toContainText('17 июля 2026 г. — 16 августа 2026 г.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
