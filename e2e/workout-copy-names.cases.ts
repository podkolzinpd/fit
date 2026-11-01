import { fulfillTrainingData } from './native-workout-fixture'
import { workoutFixture, exerciseFixture, setFixture } from './native-workout-fixture'
import { nativeSignIn } from './native-local-fixture';
import { expect, test } from './native-local-fixture';
import type { WorkoutDraft } from '../src/shared/domain';
// Historical fixtures are intercepted locally; these cases never rewrite real workouts.
const sourceId = 'c5100000-0000-4000-8000-000000000001';
const copyId = 'c5100000-0000-4000-8000-000000000002';
const oldName = 'Жим лёжа (Штанга)';
const newName = 'Жим штанги лёжа';
export function workoutCopyNamesCases() {
    for (const { role, width } of [
        { role: 'client', width: 390 }, { role: 'client', width: 430 }, { role: 'trainer', width: 1440 },
    ] as const) {
        test(`copy names: ${role} ${width} preserves originals and custom labels in light/dark`, async ({ page }, testInfo) => {
            test.setTimeout(90000);
            await page.setViewportSize({ width, height: 900 });
            const owner = role === 'trainer' ? '90000000-0000-4000-8000-000000000009' : '92000000-0000-4000-8000-000000000029';
            const row = workoutFixture({
                id: sourceId, clientId: '11111111-1111-4111-8111-111111111111', trainerId: owner, createdBy: owner,
                workoutDate: '2026-08-10', startTime: null, endTime: null, startedAt: null, completedAt: '2026-08-10T10:00:00Z',
                status: 'done', notes: 'Сохранить исходную тренировку', stageId: null, version: 3
            });
            const exercises = [
                exerciseFixture({ id: crypto.randomUUID(), source: 'system', ref: 'bench-press', name: oldName, customExerciseId: null, inputKind: 'strength', muscleGroup: 'chest' }),
                exerciseFixture({ id: crypto.randomUUID(), source: 'custom', ref: 'c5200000-0000-4000-8000-000000000099', name: oldName, customExerciseId: 'c5200000-0000-4000-8000-000000000099', inputKind: 'strength', muscleGroup: 'chest' }),
                exerciseFixture({ id: crypto.randomUUID(), source: 'system', ref: 'running', name: 'Бег — восстановление', customExerciseId: null, inputKind: 'distance', muscleGroup: 'cardio' }),
            ].map((exercise, position) => ({
                ...exercise, id: `c5200000-0000-4000-8000-00000000000${position + 1}`, position,
                blockId: `c5300000-0000-4000-8000-00000000000${position + 1}`,
                blockType: 'single' as const, blockPreset: 'set' as const, blockRounds: 1, restBetweenExercisesSec: 0,
                restBetweenRoundsSec: 90, restBetweenSetsSec: 120, trainerComment: null
            }));
            const sets = exercises.map((exercise, position) => (setFixture({
                id: `c5400000-0000-4000-8000-00000000000${position + 1}`, position: 0,
                confirmedAt: '2026-08-10T10:00:00Z', version: 2,
                plan: { weightKg: position < 2 ? 50 : null, reps: position < 2 ? 10 : null, durationSec: position === 2 ? 180 : null, distanceKm: position === 2 ? 0.5 : null },
                fact: { weightKg: position < 2 ? 55 : null, reps: position < 2 ? 9 : null, durationSec: position === 2 ? 160 : null, distanceKm: position === 2 ? 0.5 : null }
            })));
            const original = JSON.stringify({ row, exercises, sets });
            let savedCopy: WorkoutDraft | undefined;
            const submissions: WorkoutDraft[] = [];
            await page.route('**/v1/training-data?*', route => {
                const isCopy = new URL(route.request().url()).searchParams.get('workoutId') === copyId
                return fulfillTrainingData(route, [{ ...row, id: isCopy && savedCopy ? copyId : sourceId,
                    status: isCopy && savedCopy ? 'planned' : row.status,
                    exercises: exercises.map((exercise, i) => ({ ...exercise,
                        name: isCopy && savedCopy ? savedCopy.exercises[i]!.name : exercise.name,
                        sets: [sets[i]!],
                    })),
                }])
            })
            await page.route(/\/v1\/workouts(?:\/completed|\/[a-f0-9-]{36}(?:\/(?:completed|result))?)?$/, route => {
                const draft = route.request().postDataJSON() as WorkoutDraft
                const id = new URL(route.request().url()).pathname.split('/')[3]
                submissions.push({ ...draft, ...(id ? { id } : {}) })
                if (!id) savedCopy = draft
                return route.fulfill({ json: { workout: { id: id ?? copyId } } })
            })
            await page.goto('/auth');
            await nativeSignIn(page, `${role}@fit.local`);
            await expect(page).toHaveURL(role === 'client' ? /\/me$/ : /\/today$/);
            await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
            const hints = page.locator('.coachmark-bubble').getByRole('button', { name: 'Понятно', exact: true });
            while (await hints.count())
                await hints.first().click();
            for (const dark of [false, true]) {
                await page.goto(role === 'client' ? '/me/settings' : '/profile/settings');
                await page.getByRole('switch', { name: 'Тёмная тема' }).setChecked(dark);
                await page.goto(`/workouts/${sourceId}`);
                await expect(page.getByText(oldName, { exact: true })).toHaveCount(2);
                while (await hints.count())
                    await hints.first().click();
                await page.getByText(oldName, { exact: true }).first().scrollIntoViewIfNeeded();
                await page.screenshot({ path: testInfo.outputPath(`original-${dark ? 'dark' : 'light'}.png`), fullPage: true });
                await page.getByRole('button', { name: 'Другие действия с тренировкой' }).click();
                await page.getByRole('menuitem', { name: 'Копировать тренировку' }).click();
                await expect(page.getByText(newName, { exact: true })).toBeVisible();
                await expect(page.getByText(oldName, { exact: true })).toBeVisible();
                await expect(page.getByText('Бег — восстановление', { exact: true })).toBeVisible();
                await expect(page.getByRole('button', { name: 'Сохранить план', exact: true })).toBeVisible();
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                await page.getByText(newName, { exact: true }).scrollIntoViewIfNeeded();
                await page.screenshot({ path: testInfo.outputPath(`copy-${dark ? 'dark' : 'light'}.png`), fullPage: true });
                await page.locator('.planned-exercise').first().screenshot({ path: testInfo.outputPath(`system-name-${dark ? 'dark' : 'light'}.png`) });
                await page.locator('.planned-exercise').nth(1).screenshot({ path: testInfo.outputPath(`custom-name-${dark ? 'dark' : 'light'}.png`) });
                // A saved copy draft must not leak the refreshed label into editing the original.
                await page.goto(`/workouts/${sourceId}/edit`);
                await expect(page.getByText(oldName, { exact: true })).toHaveCount(2);
                await expect(page.getByText(newName, { exact: true })).toHaveCount(0);
                await page.goto(`/workouts/new?copy=${sourceId}`);
                await expect(page.getByText(newName, { exact: true })).toBeVisible();
            }
            await page.getByRole('button', { name: 'Сохранить план', exact: true }).click();
            await expect(page).toHaveURL(`/workouts/${copyId}`);
            await expect(page.getByText(newName, { exact: true })).toBeVisible();
            expect(submissions).toHaveLength(1);
            expect(savedCopy?.id).toBeUndefined();
            expect(savedCopy?.exercises.map((exercise) => exercise.name)).toEqual([newName, oldName, 'Бег — восстановление']);
            expect(savedCopy?.exercises.map((exercise) => exercise.ref)).toEqual(exercises.map((exercise) => exercise.ref));
            expect(savedCopy?.exercises[0]?.sets[0]).toMatchObject({ weightKg: 55, reps: 9 });
            await page.goto(`/workouts/${sourceId}`);
            await expect(page.getByText(oldName, { exact: true })).toHaveCount(2);
            await expect(page.getByText(newName, { exact: true })).toHaveCount(0);
            expect(JSON.stringify({ row, exercises, sets })).toBe(original);
        });
    }
}
