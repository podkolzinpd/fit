# InBody photo import

## Product contract

On `/me/progress`, an authenticated client can take or select a photo of a printed InBody sheet. The browser re-encodes it to JPEG (maximum 2 MiB and 2400 px edge), the recognition function authorizes access to that client through the existing Fit stage API, and Yandex Vision OCR returns a structured draft. The source image and raw OCR text are not persisted.

The client must review the draft before saving. Date, weight and circumferences remain editable. A recognition error stays inside the import block and offers a retry; it does not hide existing progress data.

## Stored schema

`client_progress.inbody_data` is a versioned JSON object (`schemaVersion: 1`, maximum 64 KiB). It covers body water and its components, protein, minerals, fat and lean mass, skeletal muscle, BMI/PBF, ECW/TBW, visceral fat, waist/hip ratio, phase angle, BMR, InBody score, weight-control recommendations, body-composition indices, and segmental values. Optional fields accommodate different InBody models without inventing absent measurements.

## Trust and infrastructure boundaries

- Public function: `fit-recognize-inbody` (`d4eerma5vk3fqtahbbea`) in the AI folder of cloud `brainbuster98`.
- Runtime identity: dedicated `fit-recognize-inbody` service account with only `ai.vision.user`; database access remains behind `fit-stage-api`.
- Client authorization: forwarded `x-fit-session`, verified by `GET /v1/clients/:clientId/progress` before OCR.
- OCR: `recognizeText`, `page-column-sort`, Russian and English, data logging disabled.
- Saving: existing atomic `POST /v1/progress` / `PUT /v1/progress/:id`; recognition never writes to PostgreSQL directly.
- Production frontend: uses the stable function URL; `VITE_INBODY_RECOGNITION_URL` remains an explicit override for isolated environments.

## Acceptance checks

- Camera/gallery input works at a 390 px mobile viewport and is keyboard-accessible.
- A clear sheet produces a reviewable draft; a partial/blurred sheet returns a useful retry state.
- No progress row is created until the client presses `Сохранить замер`.
- Saved InBody data is returned in the progress bundle and remains attached on edit.
- A user without access to the client cannot invoke OCR for that client.
