// АВТОГЕНЕРАЦИЯ — не редактировать вручную.
// Базовые упражнения, обогащённые из Free Exercise DB (public domain).
// Обновление: node scripts/import-exercises.mjs
import type { ExerciseSnapshot } from './domain'

export const BASE_EXERCISES: readonly ExerciseSnapshot[] = [
  {
    "source": "system",
    "ref": "barbell-squat",
    "name": "Присед со штангой (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-barbell-squat.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра",
      "Поясница"
    ],
    "level": "beginner",
    "instructions": [
      "This exercise is best performed inside a squat rack for safety purposes. To begin, first set the bar on a rack to just below shoulder level. Once the correct height is chosen and the bar is loaded, step under the bar and place the back of your shoulders (slightly below the neck) across it.",
      "Hold on to the bar using both arms at each side and lift it off the rack by first pushing with your legs and at the same time straightening your torso.",
      "Step away from the rack and position your legs using a shoulder width medium stance with the toes slightly pointed out. Keep your head up at all times and also maintain a straight back. This will be your starting position. (Note: For the purposes of this discussion we will use the medium stance described above which targets overall development; however you can choose any of the three stances discussed in the foot stances section).",
      "Begin to slowly lower the bar by bending the knees and hips as you maintain a straight posture with the head up. Continue down until the angle between the upper leg and the calves becomes slightly less than 90-degrees. Inhale as you perform this portion of the movement. Tip: If you performed the exercise correctly, the front of the knees should make an imaginary straight line with the toes that is perpendicular to the front. If your knees are past that imaginary line (if they are past your toes) then you are placing undue stress on the knee and the exercise has been performed incorrectly.",
      "Begin to raise the bar as you exhale by pushing the floor with the heel of your foot as you straighten the legs again and go back to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "front-squat",
    "name": "Фронтальный присед (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-front-squat.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "expert",
    "instructions": [
      "This exercise is best performed inside a squat rack for safety purposes. To begin, first set the bar on a rack that best matches your height. Once the correct height is chosen and the bar is loaded, bring your arms up under the bar while keeping the elbows high and the upper arm slightly above parallel to the floor. Rest the bar on top of the deltoids and cross your arms while grasping the bar for total control.",
      "Lift the bar off the rack by first pushing with your legs and at the same time straightening your torso.",
      "Step away from the rack and position your legs using a shoulder width medium stance with the toes slightly pointed out. Keep your head up at all times as looking down will get you off balance and also maintain a straight back. This will be your starting position. (Note: For the purposes of this discussion we will use the medium stance described above which targets overall development; however you can choose any of the three stances described in the foot positioning section).",
      "Begin to slowly lower the bar by bending the knees as you maintain a straight posture with the head up. Continue down until the angle between the upper leg and the calves becomes slightly less than 90-degrees (which is the point in which the upper legs are below parallel to the floor). Inhale as you perform this portion of the movement. Tip: If you performed the exercise correctly, the front of the knees should make an imaginary straight line with the toes that is perpendicular to the front. If your knees are past that imaginary line (if they are past your toes) then you are placing undue stress on the knee and the exercise has been performed incorrectly.",
      "Begin to raise the bar as you exhale by pushing the floor mainly with the middle of your foot as you straighten the legs again and go back to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "leg-press",
    "name": "Жим ногами (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-press.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "beginner",
    "instructions": [
      "Using a leg press machine, sit down on the machine and place your legs on the platform directly in front of you at a medium (shoulder width) foot stance. (Note: For the purposes of this discussion we will use the medium stance described above which targets overall development; however you can choose any of the three stances described in the foot positioning section).",
      "Lower the safety bars holding the weighted platform in place and press the platform all the way up until your legs are fully extended in front of you. Tip: Make sure that you do not lock your knees. Your torso and the legs should make a perfect 90-degree angle. This will be your starting position.",
      "As you inhale, slowly lower the platform until your upper and lower legs make a 90-degree angle.",
      "Pushing mainly with the heels of your feet and using the quadriceps go back to the starting position as you exhale.",
      "Repeat for the recommended amount of repetitions and ensure to lock the safety pins properly once you are done. You do not want that platform falling on you fully loaded."
    ]
  },
  {
    "source": "system",
    "ref": "romanian-deadlift",
    "name": "Румынская тяга (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-romanian-deadlift.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Put a barbell in front of you on the ground and grab it using a pronated (palms facing down) grip that a little wider than shoulder width. Tip: Depending on the weight used, you may need wrist wraps to perform the exercise and also a raised platform in order to allow for better range of motion.",
      "Bend the knees slightly and keep the shins vertical, hips back and back straight. This will be your starting position.",
      "Keeping your back and arms completely straight at all times, use your hips to lift the bar as you exhale. Tip: The movement should not be fast but steady and under control.",
      "Once you are standing completely straight up, lower the bar by pushing the hips back, only slightly bending the knees, unlike when squatting. Tip: Take a deep breath at the start of the movement and keep your chest up. Hold your breath as you lower and exhale as you complete the movement.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "stiff-leg-deadlift",
    "name": "Становая на прямых ногах (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-stiff-leg-deadlift.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [
      "Ягодицы",
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Grasp a bar using an overhand grip (palms facing down). You may need some wrist wraps if using a significant amount of weight.",
      "Stand with your torso straight and your legs spaced using a shoulder width or narrower stance. The knees should be slightly bent. This is your starting position.",
      "Keeping the knees stationary, lower the barbell to over the top of your feet by bending at the hips while keeping your back straight. Keep moving forward as if you were going to pick something from the floor until you feel a stretch on the hamstrings. Inhale as you perform this movement.",
      "Start bringing your torso up straight again by extending your hips until you are back at the starting position. Exhale as you perform this movement.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "lunges",
    "name": "Выпады (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-lunges.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "intermediate",
    "instructions": [
      "This exercise is best performed inside a squat rack for safety purposes. To begin, first set the bar on a rack just below shoulder level. Once the correct height is chosen and the bar is loaded, step under the bar and place the back of your shoulders (slightly below the neck) across it.",
      "Hold on to the bar using both arms at each side and lift it off the rack by first pushing with your legs and at the same time straightening your torso.",
      "Step away from the rack and step forward with your right leg and squat down through your hips, while keeping the torso upright and maintaining balance. Inhale as you go down. Note: Do not allow your knee to go forward beyond your toes as you come down, as this will put undue stress on the knee joint. li>",
      "Using mainly the heel of your foot, push up and go back to the starting position as you exhale.",
      "Repeat the movement for the recommended amount of repetitions and then perform with the left leg."
    ]
  },
  {
    "source": "system",
    "ref": "bulgarian-split-squat",
    "name": "Болгарский присед (Штанга)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-bulgarian-split-squat.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "expert",
    "instructions": [
      "Start by standing about 2 to 3 feet in front of a flat bench with your back facing the bench. Have a barbell in front of you on the floor. Tip: Your feet should be shoulder width apart from each other.",
      "Bend the knees and use a pronated grip with your hands being wider than shoulder width apart from each other to lift the barbell up until you can rest it on your chest.",
      "Then lift the barbell over your head and rest it on the base of your neck. Move one foot back so that your toe is resting on the flat bench. Your other foot should be stationary in front of you. Keep your head up at all times as looking down will get you off balance and also maintain a straight back. Tip: Make sure your back is straight and chest is out while performing this exercise.",
      "As you inhale, slowly lower your leg until your thigh is parallel to the floor. At this point, your knee should be over your toes. Your chest should be directly above the middle of your thigh.",
      "Leading with the chest and hips and contracting the quadriceps, elevate your leg back to the starting position as you exhale.",
      "Repeat for the recommended amount of repetitions.",
      "Switch legs and repeat the movement."
    ]
  },
  {
    "source": "system",
    "ref": "leg-curl",
    "name": "Сгибание ног лёжа (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-curl.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Adjust the machine lever to fit your height and lie face down on the leg curl machine with the pad of the lever on the back of your legs (just a few inches under the calves). Tip: Preferably use a leg curl machine that is angled as opposed to flat since an angled position is more favorable for hamstrings recruitment.",
      "Keeping the torso flat on the bench, ensure your legs are fully stretched and grab the side handles of the machine. Position your toes straight (or you can also use any of the other two stances described on the foot positioning section). This will be your starting position.",
      "As you exhale, curl your legs up as far as possible without lifting the upper legs from the pad. Once you hit the fully contracted position, hold it for a second.",
      "As you inhale, bring the legs back to the initial position. Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "leg-extension",
    "name": "Разгибание ног (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-extension.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "For this exercise you will need to use a leg extension machine. First choose your weight and sit on the machine with your legs under the pad (feet pointed forward) and the hands holding the side bars. This will be your starting position. Tip: You will need to adjust the pad so that it falls on top of your lower leg (just above your feet). Also, make sure that your legs form a 90-degree angle between the lower and upper leg. If the angle is less than 90-degrees then that means the knee is over the toes which in turn creates undue stress at the knee joint. If the machine is designed that way, either look for another machine or just make sure that when you start executing the exercise you stop going down once you hit the 90-degree angle.",
      "Using your quadriceps, extend your legs to the maximum as you exhale. Ensure that the rest of the body remains stationary on the seat. Pause a second on the contracted position.",
      "Slowly lower the weight back to the original position as you inhale, ensuring that you do not go past the 90-degree angle limit.",
      "Repeat for the recommended amount of times."
    ]
  },
  {
    "source": "system",
    "ref": "calf-raise",
    "name": "Подъём на носки стоя (Тренажёр)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-calf-raise.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Икры",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Adjust the padded lever of the calf raise machine to fit your height.",
      "Place your shoulders under the pads provided and position your toes facing forward (or using any of the two other positions described at the beginning of the chapter). The balls of your feet should be secured on top of the calf block with the heels extending off it. Push the lever up by extending your hips and knees until your torso is standing erect. The knees should be kept with a slight bend; never locked. Toes should be facing forward, outwards or inwards as described at the beginning of the chapter. This will be your starting position.",
      "Raise your heels as you breathe out by extending your ankles as high as possible and flexing your calf. Ensure that the knee is kept stationary at all times. There should be no bending at any time. Hold the contracted position by a second before you start to go back down.",
      "Go back slowly to the starting position as you breathe in by lowering your heels as you bend the ankles until calves are stretched.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "hyperextension",
    "name": "Гиперэкстензия (Своё тело)",
    "muscleGroup": "legs",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-hyperextension.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Поясница",
    "secondaryMuscles": [
      "Ягодицы",
      "Бицепс бедра"
    ],
    "level": "beginner",
    "instructions": [
      "Lie face down on a hyperextension bench, tucking your ankles securely under the footpads.",
      "Adjust the upper pad if possible so your upper thighs lie flat across the wide pad, leaving enough room for you to bend at the waist without any restriction.",
      "With your body straight, cross your arms in front of you (my preference) or behind your head. This will be your starting position. Tip: You can also hold a weight plate for extra resistance in front of you under your crossed arms.",
      "Start bending forward slowly at the waist as far as you can while keeping your back flat. Inhale as you perform this movement. Keep moving forward until you feel a nice stretch on the hamstrings and you can no longer keep going without a rounding of the back. Tip: Never round the back as you perform this exercise. Also, some people can go farther than others. The key thing is that you go as far as your body allows you to without rounding the back.",
      "Slowly raise your torso back to the initial position as you inhale. Tip: Avoid the temptation to arch your back past a straight line. Also, do not swing the torso at any time in order to protect the back from injury.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "bench-press",
    "name": "Жим лёжа (Штанга)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-bench-press.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Lie back on a flat bench. Using a medium width grip (a grip that creates a 90-degree angle in the middle of the movement between the forearms and the upper arms), lift the bar from the rack and hold it straight over you with your arms locked. This will be your starting position.",
      "From the starting position, breathe in and begin coming down slowly until the bar touches your middle chest.",
      "After a brief pause, push the bar back to the starting position as you breathe out. Focus on pushing the bar using your chest muscles. Lock your arms and squeeze your chest in the contracted position at the top of the motion, hold for a second and then start coming down slowly again. Tip: Ideally, lowering the weight should take about twice as long as raising it.",
      "Repeat the movement for the prescribed amount of repetitions.",
      "When you are done, place the bar back in the rack."
    ]
  },
  {
    "source": "system",
    "ref": "dumbbell-bench-press",
    "name": "Жим гантелей лёжа (Гантели)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dumbbell-bench-press.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Lie down on a flat bench with a dumbbell in each hand resting on top of your thighs. The palms of your hands will be facing each other.",
      "Then, using your thighs to help raise the dumbbells up, lift the dumbbells one at a time so that you can hold them in front of you at shoulder width.",
      "Once at shoulder width, rotate your wrists forward so that the palms of your hands are facing away from you. The dumbbells should be just to the sides of your chest, with your upper arm and forearm creating a 90 degree angle. Be sure to maintain full control of the dumbbells at all times. This will be your starting position.",
      "Then, as you breathe out, use your chest to push the dumbbells up. Lock your arms at the top of the lift and squeeze your chest, hold for a second and then begin coming down slowly. Tip: Ideally, lowering the weight should take about twice as long as raising it.",
      "Repeat the movement for the prescribed amount of repetitions of your training program."
    ]
  },
  {
    "source": "system",
    "ref": "incline-bench-press",
    "name": "Жим на наклонной (Штанга)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-incline-bench-press.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Lie back on an incline bench. Using a medium-width grip (a grip that creates a 90-degree angle in the middle of the movement between the forearms and the upper arms), lift the bar from the rack and hold it straight over you with your arms locked. This will be your starting position.",
      "As you breathe in, come down slowly until you feel the bar on you upper chest.",
      "After a second pause, bring the bar back to the starting position as you breathe out and push the bar using your chest muscles. Lock your arms in the contracted position, squeeze your chest, hold for a second and then start coming down slowly again. Tip: it should take at least twice as long to go down than to come up.",
      "Repeat the movement for the prescribed amount of repetitions.",
      "When you are done, place the bar back in the rack."
    ]
  },
  {
    "source": "system",
    "ref": "dumbbell-fly",
    "name": "Разводка гантелей (Гантели)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dumbbell-fly.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Lie down on a flat bench with a dumbbell on each hand resting on top of your thighs. The palms of your hand will be facing each other.",
      "Then using your thighs to help raise the dumbbells, lift the dumbbells one at a time so you can hold them in front of you at shoulder width with the palms of your hands facing each other. Raise the dumbbells up like you're pressing them, but stop and hold just before you lock out. This will be your starting position.",
      "With a slight bend on your elbows in order to prevent stress at the biceps tendon, lower your arms out at both sides in a wide arc until you feel a stretch on your chest. Breathe in as you perform this portion of the movement. Tip: Keep in mind that throughout the movement, the arms should remain stationary; the movement should only occur at the shoulder joint.",
      "Return your arms back to the starting position as you squeeze your chest muscles and breathe out. Tip: Make sure to use the same arc of motion used to lower the weights.",
      "Hold for a second at the contracted position and repeat the movement for the prescribed amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "push-ups",
    "name": "Отжимания (Своё тело)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-push-ups.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Lie on the floor face down and place your hands about 36 inches apart while holding your torso up at arms length.",
      "Next, lower yourself downward until your chest almost touches the floor as you inhale.",
      "Now breathe out and press your upper body back up to the starting position while squeezing your chest.",
      "After a brief pause at the top contracted position, you can begin to lower yourself downward again for as many repetitions as needed."
    ]
  },
  {
    "source": "system",
    "ref": "dips",
    "name": "Отжимания на брусьях (Своё тело)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dips.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [
      "Плечи",
      "Трицепс"
    ],
    "level": "intermediate",
    "instructions": [
      "For this exercise you will need access to parallel bars. To get yourself into the starting position, hold your body at arms length (arms locked) above the bars.",
      "While breathing in, lower yourself slowly with your torso leaning forward around 30 degrees or so and your elbows flared out slightly until you feel a slight stretch in the chest.",
      "Once you feel the stretch, use your chest to bring your body back to the starting position as you breathe out. Tip: Remember to squeeze the chest at the top of the movement for a second.",
      "Repeat the movement for the prescribed amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "pec-deck",
    "name": "Сведение в тренажёре (Тренажёр)",
    "muscleGroup": "chest",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-pec-deck.jpg",
    "equipment": "Тренажёр",
    "equipmentRef": "machine",
    "primaryMuscleDetail": "Грудь",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Sit on the machine with your back flat on the pad.",
      "Take hold of the handles. Tip: Your upper arms should be positioned parallel to the floor; adjust the machine accordingly. This will be your starting position.",
      "Push the handles together slowly as you squeeze your chest in the middle. Breathe out during this part of the motion and hold the contraction for a second.",
      "Return back to the starting position slowly as you inhale until your chest muscles are fully stretched.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "barbell-row",
    "name": "Тяга штанги в наклоне (Штанга)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-barbell-row.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Середина спины",
    "secondaryMuscles": [
      "Бицепс",
      "Широчайшие",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Holding a barbell with a pronated grip (palms facing down), bend your knees slightly and bring your torso forward, by bending at the waist, while keeping the back straight until it is almost parallel to the floor. Tip: Make sure that you keep the head up. The barbell should hang directly in front of you as your arms hang perpendicular to the floor and your torso. This is your starting position.",
      "Now, while keeping the torso stationary, breathe out and lift the barbell to you. Keep the elbows close to the body and only use the forearms to hold the weight. At the top contracted position, squeeze the back muscles and hold for a brief pause.",
      "Then inhale and slowly lower the barbell back to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "dumbbell-row",
    "name": "Тяга гантели в наклоне (Гантели)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-dumbbell-row.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Середина спины",
    "secondaryMuscles": [
      "Бицепс",
      "Широчайшие",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Choose a flat bench and place a dumbbell on each side of it.",
      "Place the right leg on top of the end of the bench, bend your torso forward from the waist until your upper body is parallel to the floor, and place your right hand on the other end of the bench for support.",
      "Use the left hand to pick up the dumbbell on the floor and hold the weight while keeping your lower back straight. The palm of the hand should be facing your torso. This will be your starting position.",
      "Pull the resistance straight up to the side of your chest, keeping your upper arm close to your side and keeping the torso stationary. Breathe out as you perform this step. Tip: Concentrate on squeezing the back muscles once you reach the full contracted position. Also, make sure that the force is performed with the back muscles and not the arms. Finally, the upper torso should remain stationary and only the arms should move. The forearms should do no other work except for holding the dumbbell; therefore do not try to pull the dumbbell up using the forearms.",
      "Lower the resistance straight down to the starting position. Breathe in as you perform this step.",
      "Repeat the movement for the specified amount of repetitions.",
      "Switch sides and repeat again with the other arm."
    ]
  },
  {
    "source": "system",
    "ref": "pull-ups",
    "name": "Подтягивания (Своё тело)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-pull-ups.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Широчайшие",
    "secondaryMuscles": [
      "Бицепс",
      "Середина спины"
    ],
    "level": "beginner",
    "instructions": [
      "Grab the pull-up bar with the palms facing forward using the prescribed grip. Note on grips: For a wide grip, your hands need to be spaced out at a distance wider than your shoulder width. For a medium grip, your hands need to be spaced out at a distance equal to your shoulder width and for a close grip at a distance smaller than your shoulder width.",
      "As you have both arms extended in front of you holding the bar at the chosen grip width, bring your torso back around 30 degrees or so while creating a curvature on your lower back and sticking your chest out. This is your starting position.",
      "Pull your torso up until the bar touches your upper chest by drawing the shoulders and the upper arms down and back. Exhale as you perform this portion of the movement. Tip: Concentrate on squeezing the back muscles once you reach the full contracted position. The upper torso should remain stationary as it moves through space and only the arms should move. The forearms should do no other work other than hold the bar.",
      "After a second on the contracted position, start to inhale and slowly lower your torso back to the starting position when your arms are fully extended and the lats are fully stretched.",
      "Repeat this motion for the prescribed amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "lat-pulldown",
    "name": "Тяга верхнего блока (Блок)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-lat-pulldown.jpg",
    "equipment": "Блок",
    "equipmentRef": "cable",
    "primaryMuscleDetail": "Широчайшие",
    "secondaryMuscles": [
      "Бицепс",
      "Середина спины",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "Sit down on a pull-down machine with a wide bar attached to the top pulley. Make sure that you adjust the knee pad of the machine to fit your height. These pads will prevent your body from being raised by the resistance attached to the bar.",
      "Grab the bar with the palms facing forward using the prescribed grip. Note on grips: For a wide grip, your hands need to be spaced out at a distance wider than shoulder width. For a medium grip, your hands need to be spaced out at a distance equal to your shoulder width and for a close grip at a distance smaller than your shoulder width.",
      "As you have both arms extended in front of you holding the bar at the chosen grip width, bring your torso back around 30 degrees or so while creating a curvature on your lower back and sticking your chest out. This is your starting position.",
      "As you breathe out, bring the bar down until it touches your upper chest by drawing the shoulders and the upper arms down and back. Tip: Concentrate on squeezing the back muscles once you reach the full contracted position. The upper torso should remain stationary and only the arms should move. The forearms should do no other work except for holding the bar; therefore do not try to pull down the bar using the forearms.",
      "After a second at the contracted position squeezing your shoulder blades together, slowly raise the bar back to the starting position when your arms are fully extended and the lats are fully stretched. Inhale during this portion of the movement.",
      "Repeat this motion for the prescribed amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "seated-cable-row",
    "name": "Тяга нижнего блока (Блок)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-seated-cable-row.jpg",
    "equipment": "Блок",
    "equipmentRef": "cable",
    "primaryMuscleDetail": "Середина спины",
    "secondaryMuscles": [
      "Бицепс",
      "Широчайшие",
      "Плечи"
    ],
    "level": "beginner",
    "instructions": [
      "For this exercise you will need access to a low pulley row machine with a V-bar. Note: The V-bar will enable you to have a neutral grip where the palms of your hands face each other. To get into the starting position, first sit down on the machine and place your feet on the front platform or crossbar provided making sure that your knees are slightly bent and not locked.",
      "Lean over as you keep the natural alignment of your back and grab the V-bar handles.",
      "With your arms extended pull back until your torso is at a 90-degree angle from your legs. Your back should be slightly arched and your chest should be sticking out. You should be feeling a nice stretch on your lats as you hold the bar in front of you. This is the starting position of the exercise.",
      "Keeping the torso stationary, pull the handles back towards your torso while keeping the arms close to it until you touch the abdominals. Breathe out as you perform that movement. At that point you should be squeezing your back muscles hard. Hold that contraction for a second and slowly go back to the original position while breathing in.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "deadlift",
    "name": "Становая тяга (Штанга)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-deadlift.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Поясница",
    "secondaryMuscles": [
      "Икры",
      "Предплечья",
      "Ягодицы",
      "Бицепс бедра",
      "Широчайшие",
      "Середина спины",
      "Квадрицепс",
      "Трапеции"
    ],
    "level": "intermediate",
    "instructions": [
      "Stand in front of a loaded barbell.",
      "While keeping the back as straight as possible, bend your knees, bend forward and grasp the bar using a medium (shoulder width) overhand grip. This will be the starting position of the exercise. Tip: If it is difficult to hold on to the bar with this grip, alternate your grip or use wrist straps.",
      "While holding the bar, start the lift by pushing with your legs while simultaneously getting your torso to the upright position as you breathe out. In the upright position, stick your chest out and contract the back by bringing the shoulder blades back. Think of how the soldiers in the military look when they are in standing in attention.",
      "Go back to the starting position by bending at the knees while simultaneously leaning the torso forward at the waist while keeping the back straight. When the weights on the bar touch the floor you are back at the starting position and ready to perform another repetition.",
      "Perform the amount of repetitions prescribed in the program."
    ]
  },
  {
    "source": "system",
    "ref": "good-morning",
    "name": "Гудмонинг (Штанга)",
    "muscleGroup": "back",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-good-morning.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс бедра",
    "secondaryMuscles": [
      "Пресс",
      "Ягодицы",
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Begin with a bar on a rack at shoulder height. Rack the bar across the rear of your shoulders as you would a power squat, not on top of your shoulders. Keep your back tight, shoulder blades pinched together, and your knees slightly bent. Step back from the rack.",
      "Begin by bending at the hips, moving them back as you bend over to near parallel. Keep your back arched and your cervical spine in proper alignment.",
      "Reverse the motion by extending through the hips with your glutes and hamstrings. Continue until you have returned to the starting position."
    ]
  },
  {
    "source": "system",
    "ref": "overhead-press",
    "name": "Жим штанги стоя (Штанга)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-overhead-press.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [
      "Трицепс"
    ],
    "level": "beginner",
    "instructions": [
      "Start by placing a barbell that is about chest high on a squat rack. Once you have selected the weights, grab the barbell using a pronated (palms facing forward) grip. Make sure to grip the bar wider than shoulder width apart from each other.",
      "Slightly bend the knees and place the barbell on your collar bone. Lift the barbell up keeping it lying on your chest. Take a step back and position your feet shoulder width apart from each other.",
      "Once you pick up the barbell with the correct grip length, lift the bar up over your head by locking your arms. Hold at about shoulder level and slightly in front of your head. This is your starting position.",
      "Lower the bar down to the collarbone slowly as you inhale.",
      "Lift the bar back up to the starting position as you exhale.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "seated-dumbbell-press",
    "name": "Жим гантелей сидя (Гантели)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-seated-dumbbell-press.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [
      "Трицепс"
    ],
    "level": "intermediate",
    "instructions": [
      "While holding a dumbbell in each hand, sit on a military press bench or utility bench that has back support. Place the dumbbells upright on top of your thighs.",
      "Now raise the dumbbells to shoulder height one at a time using your thighs to help propel them up into position.",
      "Make sure to rotate your wrists so that the palms of your hands are facing forward. This is your starting position.",
      "Now, exhale and push the dumbbells upward until they touch at the top.",
      "Then, after a brief pause at the top contracted position, slowly lower the weights back down to the starting position while inhaling.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "lateral-raise",
    "name": "Разводка в стороны (Гантели)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-lateral-raise.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Pick a couple of dumbbells and stand with a straight torso and the dumbbells by your side at arms length with the palms of the hand facing you. This will be your starting position.",
      "While maintaining the torso in a stationary position (no swinging), lift the dumbbells to your side with a slight bend on the elbow and the hands slightly tilted forward as if pouring water in a glass. Continue to go up until you arms are parallel to the floor. Exhale as you execute this movement and pause for a second at the top.",
      "Lower the dumbbells back down slowly to the starting position as you inhale.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "rear-delt-fly",
    "name": "Разводка на заднюю дельту (Гантели)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-rear-delt-fly.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "To begin, lie down on an incline bench with the chest and stomach pressing against the incline. Have the dumbbells in each hand with the palms facing each other (neutral grip).",
      "Extend the arms in front of you so that they are perpendicular to the angle of the bench. The legs should be stationary while applying pressure with the ball of your toes. This is the starting position.",
      "Maintaining the slight bend of the elbows, move the weights out and away from each other (to the side) in an arc motion while exhaling. Tip: Try to squeeze your shoulder blades together to get the best results from this exercise.",
      "The arms should be elevated until they are parallel to the floor.",
      "Feel the contraction and slowly lower the weights back down to the starting position while inhaling.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "upright-row",
    "name": "Тяга к подбородку (Штанга)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-upright-row.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Плечи",
    "secondaryMuscles": [
      "Трапеции"
    ],
    "level": "beginner",
    "instructions": [
      "Grasp a barbell with an overhand grip that is slightly less than shoulder width. The bar should be resting on the top of your thighs with your arms extended and a slight bend in your elbows. Your back should also be straight. This will be your starting position.",
      "Now exhale and use the sides of your shoulders to lift the bar, raising your elbows up and to the side. Keep the bar close to your body as you raise it. Continue to lift the bar until it nearly touches your chin. Tip: Your elbows should drive the motion, and should always be higher than your forearms. Remember to keep your torso stationary and pause for a second at the top of the movement.",
      "Lower the bar back down slowly to the starting position. Inhale as you perform this portion of the movement.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "shrugs",
    "name": "Шраги (Штанга)",
    "muscleGroup": "shoulders",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-shrugs.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Трапеции",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Stand up straight with your feet at shoulder width as you hold a barbell with both hands in front of you using a pronated grip (palms facing the thighs). Tip: Your hands should be a little wider than shoulder width apart. You can use wrist wraps for this exercise for a better grip. This will be your starting position.",
      "Raise your shoulders up as far as you can go as you breathe out and hold the contraction for a second. Tip: Refrain from trying to lift the barbell by using your biceps.",
      "Slowly return to the starting position as you breathe in.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "biceps-curl",
    "name": "Сгибание на бицепс (Гантели)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-biceps-curl.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Бицепс",
    "secondaryMuscles": [
      "Предплечья"
    ],
    "level": "beginner",
    "instructions": [
      "Stand up straight with a dumbbell in each hand at arm's length. Keep your elbows close to your torso and rotate the palms of your hands until they are facing forward. This will be your starting position.",
      "Now, keeping the upper arms stationary, exhale and curl the weights while contracting your biceps. Continue to raise the weights until your biceps are fully contracted and the dumbbells are at shoulder level. Hold the contracted position for a brief pause as you squeeze your biceps.",
      "Then, inhale and slowly begin to lower the dumbbells back to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "hammer-curl",
    "name": "Молоток (Гантели)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-hammer-curl.jpg",
    "equipment": "Гантели",
    "equipmentRef": "dumbbell",
    "primaryMuscleDetail": "Бицепс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Stand up with your torso upright and a dumbbell on each hand being held at arms length. The elbows should be close to the torso.",
      "The palms of the hands should be facing your torso. This will be your starting position.",
      "Now, while holding your upper arm stationary, exhale and curl the weight forward while contracting the biceps. Continue to raise the weight until the biceps are fully contracted and the dumbbell is at shoulder level. Hold the contracted position for a brief moment as you squeeze the biceps. Tip: Focus on keeping the elbow stationary and only moving your forearm.",
      "After the brief pause, inhale and slowly begin the lower the dumbbells back down to the starting position.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "barbell-curl",
    "name": "Подъём штанги на бицепс (Штанга)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-barbell-curl.jpg",
    "equipment": "Штанга",
    "equipmentRef": "barbell",
    "primaryMuscleDetail": "Бицепс",
    "secondaryMuscles": [
      "Предплечья"
    ],
    "level": "beginner",
    "instructions": [
      "Stand up with your torso upright while holding a barbell at a shoulder-width grip. The palm of your hands should be facing forward and the elbows should be close to the torso. This will be your starting position.",
      "While holding the upper arms stationary, curl the weights forward while contracting the biceps as you breathe out. Tip: Only the forearms should move.",
      "Continue the movement until your biceps are fully contracted and the bar is at shoulder level. Hold the contracted position for a second and squeeze the biceps hard.",
      "Slowly begin to bring the bar back to starting position as your breathe in.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "french-press",
    "name": "Французский жим (EZ-гриф)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-french-press.jpg",
    "equipment": "EZ-гриф",
    "equipmentRef": "e-z curl bar",
    "primaryMuscleDetail": "Трицепс",
    "secondaryMuscles": [],
    "level": "intermediate",
    "instructions": [
      "Lie on a flat bench with either an e-z bar (my preference) or a straight bar placed on the floor behind your head and your feet on the floor.",
      "Grab the bar behind you, using a medium overhand (pronated) grip, and raise the bar in front of you at arms length. Tip: The arms should be perpendicular to the torso and the floor. The elbows should be tucked in. This is the starting position.",
      "As you breathe in, slowly lower the weight until the bar lightly touches your forehead while keeping the upper arms and elbows stationary.",
      "At that point, use the triceps to bring the weight back up to the starting position as you breathe out.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "triceps-pushdown",
    "name": "Разгибание на трицепс (Блок)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-triceps-pushdown.jpg",
    "equipment": "Блок",
    "equipmentRef": "cable",
    "primaryMuscleDetail": "Трицепс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Attach a straight or angled bar to a high pulley and grab with an overhand grip (palms facing down) at shoulder width.",
      "Standing upright with the torso straight and a very small inclination forward, bring the upper arms close to your body and perpendicular to the floor. The forearms should be pointing up towards the pulley as they hold the bar. This is your starting position.",
      "Using the triceps, bring the bar down until it touches the front of your thighs and the arms are fully extended perpendicular to the floor. The upper arms should always remain stationary next to your torso and only the forearms should move. Exhale as you perform this movement.",
      "After a second hold at the contracted position, bring the bar slowly up to the starting point. Breathe in as you perform this step.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "close-grip-push-up",
    "name": "Отжимания узким хватом (Своё тело)",
    "muscleGroup": "arms",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-close-grip-push-up.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Трицепс",
    "secondaryMuscles": [
      "Грудь",
      "Плечи"
    ],
    "level": "intermediate",
    "instructions": [
      "Lie on the floor face down and place your hands closer than shoulder width for a close hand position. Make sure that you are holding your torso up at arms' length.",
      "Lower yourself until your chest almost touches the floor as you inhale.",
      "Using your triceps and some of your pectoral muscles, press your upper body back up to the starting position and squeeze your chest. Breathe out as you perform this step.",
      "After a second pause at the contracted position, repeat the movement for the prescribed amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "plank",
    "name": "Планка (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "reps",
    "imageUrl": "/exercises/base-plank.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Get into a prone position on the floor, supporting your weight on your toes and your forearms. Your arms are bent and directly below the shoulder.",
      "Keep your body straight at all times, and hold this position as long as possible. To increase difficulty, an arm or leg can be raised."
    ]
  },
  {
    "source": "system",
    "ref": "crunches",
    "name": "Скручивания (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-crunches.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Lie flat on your back with your feet flat on the ground, or resting on a bench with your knees bent at a 90 degree angle. If you are resting your feet on a bench, place them three to four inches apart and point your toes inward so they touch.",
      "Now place your hands lightly on either side of your head keeping your elbows in. Tip: Don't lock your fingers behind your head.",
      "While pushing the small of your back down in the floor to better isolate your abdominal muscles, begin to roll your shoulders off the floor.",
      "Continue to push down as hard as you can with your lower back as you contract your abdominals and exhale. Your shoulders should come up off the floor only about four inches, and your lower back should remain on the floor. At the top of the movement, contract your abdominals hard and keep the contraction for a second. Tip: Focus on slow, controlled movement - don't cheat yourself by using momentum.",
      "After the one second contraction, begin to come down slowly again to the starting position as you inhale.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "leg-raise",
    "name": "Подъём ног лёжа (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-leg-raise.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Lie with your back flat on a bench and your legs extended in front of you off the end.",
      "Place your hands either under your glutes with your palms down or by the sides holding on to the bench. This will be your starting position.",
      "As you keep your legs extended, straight as possible with your knees slightly bent but locked raise your legs until they make a 90-degree angle with the floor. Exhale as you perform this portion of the movement and hold the contraction at the top for a second.",
      "Now, as you inhale, slowly lower your legs back down to the starting position."
    ]
  },
  {
    "source": "system",
    "ref": "russian-twist",
    "name": "Русский твист (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "strength",
    "imageUrl": "/exercises/base-russian-twist.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [
      "Поясница"
    ],
    "level": "intermediate",
    "instructions": [
      "Lie down on the floor placing your feet either under something that will not move or by having a partner hold them. Your legs should be bent at the knees.",
      "Elevate your upper body so that it creates an imaginary V-shape with your thighs. Your arms should be fully extended in front of you perpendicular to your torso and with the hands clasped. This is the starting position.",
      "Twist your torso to the right side until your arms are parallel with the floor while breathing out.",
      "Hold the contraction for a second and move back to the starting position while breathing out. Now move to the opposite side performing the same techniques you applied to the right side.",
      "Repeat for the recommended amount of repetitions."
    ]
  },
  {
    "source": "system",
    "ref": "side-plank",
    "name": "Боковая планка (Своё тело)",
    "muscleGroup": "core",
    "inputKind": "reps",
    "imageUrl": "/exercises/base-side-plank.jpg",
    "equipment": "Своё тело",
    "equipmentRef": "body only",
    "primaryMuscleDetail": "Пресс",
    "secondaryMuscles": [
      "Плечи"
    ],
    "level": "beginner",
    "instructions": []
  },
  {
    "source": "system",
    "ref": "running",
    "name": "Бег (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Бегите в равномерном темпе, удерживая корпус прямым, руки согнуты под углом ~90°.",
      "Дышите ритмично; контролируйте пульс по плану тренировки."
    ]
  },
  {
    "source": "system",
    "ref": "stationary-bike",
    "name": "Велотренажёр (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Настройте посадку и сопротивление под план.",
      "Крутите педали в равномерном темпе, удерживая корпус стабильным."
    ]
  },
  {
    "source": "system",
    "ref": "elliptical",
    "name": "Эллипс (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Встаньте на платформы, возьмитесь за рукояти.",
      "Двигайтесь плавно, согласуя движения рук и ног, без рывков."
    ]
  },
  {
    "source": "system",
    "ref": "rowing-machine",
    "name": "Гребной тренажёр (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Оттолкнитесь ногами, затем подтяните рукоять к корпусу.",
      "Вернитесь в исходное в обратном порядке: руки — корпус — ноги."
    ]
  },
  {
    "source": "system",
    "ref": "walking",
    "name": "Ходьба (Кардио)",
    "muscleGroup": "cardio",
    "inputKind": "distance",
    "equipment": "Кардио",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Кардио",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Идите в заданном темпе, держите корпус прямым.",
      "Контролируйте продолжительность и дистанцию по плану."
    ]
  },
  {
    "source": "system",
    "ref": "jump-rope",
    "name": "Прыжки со скакалкой (Скакалка)",
    "muscleGroup": "cardio",
    "inputKind": "reps",
    "imageUrl": "/exercises/base-jump-rope.jpg",
    "equipment": "Другое",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Квадрицепс",
    "secondaryMuscles": [
      "Икры",
      "Бицепс бедра"
    ],
    "level": "intermediate",
    "instructions": [
      "Hold an end of the rope in each hand. Position the rope behind you on the ground. Raise your arms up and turn the rope over your head bringing it down in front of you. When it reaches the ground, jump over it. Find a good turning pace that can be maintained. Different speeds and techniques can be used to introduce variation.",
      "Rope jumping is exciting, challenges your coordination, and requires a lot of energy. A 150 lb person will burn about 350 calories jumping rope for 30 minutes, compared to over 450 calories running."
    ]
  },
  {
    "source": "system",
    "ref": "burpees",
    "name": "Берпи (Своё тело)",
    "muscleGroup": "cardio",
    "inputKind": "reps",
    "equipment": "Своё тело",
    "equipmentRef": "other",
    "primaryMuscleDetail": "Всё тело",
    "secondaryMuscles": [],
    "level": "beginner",
    "instructions": [
      "Из положения стоя присядьте и поставьте ладони на пол.",
      "Прыжком отведите ноги назад в упор лёжа, сделайте отжимание.",
      "Прыжком верните ноги к рукам и выпрыгните вверх с хлопком над головой."
    ]
  }
]
