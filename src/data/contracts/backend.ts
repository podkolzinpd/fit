import type {
  Client,
  ClientAttentionPreference,
  CreateClientInput,
  UpdateClientInput,
  UpdateClientTrainerPreferencesInput,
  ChatThread,
  ChatBlockState,
  ChatConnectionState,
  ChatMessagePage,
  ChatImageDraft,
  ChatMessage,
  ChatUnreadState,
  ExerciseSnapshot,
  CustomMetric,
  ClientGoal,
  SaveClientGoalInput,
  SaveGoalStageInput,
  GoalStage,
  InvitationShare,
  InvitationLinkPreview,
  ClientInvitation,
  TrainerMembership,
  InBodyRecognitionImage,
  InBodyRecognitionResult,
  WorkoutRegularity,
  RunningProgressSession,
  ProgressEntry,
  ProgressDraft,
  Workout,
  WorkoutSummary,
  WorkoutHomeSummary,
  ClientStats,
  WorkoutPersonalRecord,
  ExerciseProgressCursor,
  ExerciseProgressPage,
  WorkoutDraft,
  LiveSetDraft,
  WorkoutTrainerResponseDraft,
  WorkoutFeedbackDraft,
  WorkoutQuestionAnswerDraft,
  TrainerAttentionWorkout,
  WorkoutTemplate,
  WorkoutTemplateDraft,
  TrainingSummary,
  PublishedTrainingSummary,
  TrainingSummaryTriggerReason,
  ClientTrainingSummary,
  TrainerWorkspace,
} from '../../shared/domain'
import type { ChatMeetingsRepository } from '../../shared/meeting'
import type { WorkoutParseResponse } from '../../shared/workout-parse-response'
import type { GoalCriteriaSuggestionResult } from '../../shared/goal-criteria-suggestions'
import type { CustomExercise, CustomExerciseDraft } from './exercises'
import type { PreparedImage } from '../../shared/image-prep'
import type { LegalAcceptanceStatus, AccountDeletionStatus } from '../../shared/legal'
import type { LocalDate } from '../../shared/local-date'
import type { PreviousExerciseResult } from './workouts'
import type { FavoriteWorkoutsRepository } from './favorite-workouts'
import type { TrainerProfilesRepository } from './trainer-profiles'
import type { TrainerDiscoveryRepository } from './trainer-discovery'
import type { TrainerFinanceRepository } from './trainer-finance'
import type { ClientFinanceRepository } from './client-finance'
import type { AthleteSportProfileRepository } from './athlete-sport-profile'
import type { NutritionRepository } from './nutrition'
import type { AppFeedbackKind, AppFeedbackInput } from '../repositories/app-feedback-context'
import type { NotificationStatus } from './push-notifications'
import type { ClientRealtimeChange } from './realtime'
export interface DataBackend {
  source: 'yandex'
  clients: {
    getMine(): Promise<Client | null>
    resolveId: (id: string) => Promise<string>
    list(includeArchived?: boolean): Promise<Client[]>
    listAttentionPreferences(trainerId: string): Promise<ClientAttentionPreference[]>
    get(id: string): Promise<Client>
    create(input: CreateClientInput): Promise<string>
    createQuick(fullName: string): Promise<string>
    createQuickOwn(fullName: string): Promise<string>
    createOwn(input: CreateClientInput): Promise<string>
    update(input: UpdateClientInput): Promise<void>
    updateOwn(input: UpdateClientInput): Promise<void>
    updatePreferences(input: UpdateClientTrainerPreferencesInput): Promise<void>
    setArchived(client: Client, archived: boolean): Promise<Client>
  }
  meetings?: ChatMeetingsRepository
  chat: {
    listThreads(): Promise<ChatThread[]>
    open(clientId: string, trainerId: string): Promise<string>
    openPublicTrainer(publicProfileId: string): Promise<string>
    setBlocked(conversationId: string, blocked: boolean): Promise<ChatBlockState>
    connectionState(conversationId: string): Promise<ChatConnectionState>
    inviteToConnect(conversationId: string): Promise<ChatConnectionState>
    acceptConnection(conversationId: string): Promise<ChatConnectionState>
    listMessages(conversationId: string, cursor?: {
      createdAt: string
      id: string
    } | null): Promise<ChatMessagePage>
    send(conversationId: string, messageId: string, body: string, image?: ChatImageDraft | null, replyToMessageId?: string | null): Promise<ChatMessage>
    edit(conversationId: string, messageId: string, body: string): Promise<ChatMessage>
    remove(conversationId: string, messageId: string): Promise<void>
    unreadState(conversationId: string): Promise<ChatUnreadState>
    markRead(conversationId: string, throughMessageId: string): Promise<void>
    search(conversationId: string, query: string): Promise<ChatMessage[]>
    window(conversationId: string, messageId: string): Promise<ChatMessage[]>
    subscribe(conversationId: string, onChange: () => void): () => void
  }
  exercises: {
    vitalMediaMode: "public" | "signed"
    system: readonly ExerciseSnapshot[]
    createVitalMediaUrl: (path: string, expiresIn: number) => Promise<string>
    createCustomExercisePhotoUrl(path: string, expiresIn: number): Promise<string>
    parseWorkout(text: string, systemCatalog: readonly ExerciseSnapshot[]): Promise<WorkoutParseResponse>
    suggestGoalCriteria(text: string, catalog: readonly ExerciseSnapshot[], metrics: readonly CustomMetric[]): Promise<GoalCriteriaSuggestionResult>
    list(): Promise<CustomExercise[]>
    create(partitionOwnerId: string, actorId: string, value: CustomExerciseDraft, photo?: PreparedImage | null): Promise<CustomExercise>
    update(exercise: CustomExercise, value: CustomExerciseDraft): Promise<CustomExercise>
    setArchived(exercise: CustomExercise, archived: boolean): Promise<CustomExercise>
  }
  goals: {
    get(clientId: string): Promise<ClientGoal | null>
    save(input: SaveClientGoalInput): Promise<string>
    archive(goalId: string, version: number): Promise<void>
    saveStage(input: SaveGoalStageInput): Promise<string>
    deleteStage(stage: Pick<GoalStage, "id" | "version">): Promise<void>
  }
  invitations: {
    createShareForNewClient(fullName: string, operationId: string): Promise<{
      clientId: string
      share: InvitationShare
    }>
    create(clientId: string, targetRole: "client" | "trainer"): Promise<string>
    createShare(clientId: string, targetRole: "client" | "trainer"): Promise<InvitationShare>
    previewLink(token: string): Promise<InvitationLinkPreview | null>
    claimLink(token: string): Promise<string>
    claim(code: string): Promise<string>
    reconnect(code: string): Promise<string>
    list(clientId: string): Promise<ClientInvitation[]>
    listTrainers(clientId: string): Promise<TrainerMembership[]>
    revoke(invitationId: string): Promise<void>
    removeTrainer(clientId: string, trainerId: string): Promise<void>
    leave(clientId: string): Promise<void>
  }
  legal: {
    getAcceptanceStatus(): Promise<LegalAcceptanceStatus>
    acceptCurrent(source?: "registration" | "existing_user"): Promise<string>
    getAccountDeletionStatus(): Promise<AccountDeletionStatus>
    requestAccountDeletion(): Promise<string>
    cancelAccountDeletionRequest(): Promise<void>
  }
  progress: {
    recognizeInBody(clientId: string, image: InBodyRecognitionImage): Promise<InBodyRecognitionResult>
    regularity(clientId: string): Promise<WorkoutRegularity[]>
    running(clientId: string, periodStart: string, periodEnd: string): Promise<RunningProgressSession[]>
    list(clientId: string): Promise<ProgressEntry[]>
    save(draft: ProgressDraft): Promise<string>
    remove(entry: ProgressEntry): Promise<void>
    listMetrics(clientId: string): Promise<CustomMetric[]>
    createMetric(clientId: string, name: string, unit: string | null): Promise<CustomMetric>
    setMetricArchived(metric: CustomMetric, archived: boolean): Promise<CustomMetric>
  }
  workouts: {
    supportsAtomicLiveRounds: boolean
    supportsLiveSupersetSplit: boolean
    get: (id: string) => Promise<Workout>
    listPage: (from?: string, to?: string, clientId?: string, offset?: number, pageSize?: number) => Promise<{
      totalCount: number
      items: Workout[]
      nextOffset?: number
    }>
    list(from?: string, to?: string, clientId?: string): Promise<Workout[]>
    listSummaries: (clientId: string) => Promise<WorkoutSummary[]>
    home(today: LocalDate): Promise<WorkoutHomeSummary[]>
    clientStats(clientId: string, today: LocalDate): Promise<ClientStats>
    findActive: (clientId: string) => Promise<WorkoutSummary | null>
    quickStart(clientId?: string, operationId?: string, trainingFormat?: "self" | "with_trainer"): Promise<{
      id: string
      resumed: boolean
    }>
    cancelEmpty(workout: Workout): Promise<void>
    personalRecords(workoutId: string): Promise<WorkoutPersonalRecord[]>
    latestExerciseResults(clientId: string, exerciseRefs: string[]): Promise<Map<string, PreviousExerciseResult>>
    exerciseProgressPage(clientId: string, exerciseRef: string, cursor: ExerciseProgressCursor | null): Promise<ExerciseProgressPage>
    save(draft: WorkoutDraft): Promise<string>
    saveCompleted(draft: WorkoutDraft): Promise<string>
    recordPlannedResult(draft: WorkoutDraft): Promise<string>
    start(workout: Workout): Promise<number>
    cancelPlanned(workout: Workout): Promise<number>
    reschedule(workout: Workout, workoutDate: LocalDate, startTime: string | null): Promise<number>
    saveLiveSet(id: string, draft: LiveSetDraft, version: number): Promise<number>
    confirmLiveSet(id: string, version: number): Promise<number>
    appendLiveExercise(workout: Workout, exercise: ExerciseSnapshot, _operationId?: string, prefillFromHistory?: boolean): Promise<number>
    appendLiveSet(workout: Workout, exerciseId: string): Promise<number>
    appendLiveRound(workout: Workout, blockId: string, operationId: string): Promise<number>
    removeLastLiveRound(workout: Workout, blockId: string, position: number, operationId: string): Promise<number>
    splitLiveSuperset(workout: Workout, blockId: string, operationId: string): Promise<number>
    removeLiveSet(workout: Workout, setId: string, guard?: {
      expectedSetVersion: number
      operationId: string
    }): Promise<number>
    removeLiveExercise(workout: Workout, exerciseId: string): Promise<number>
    reorderLiveBlock(workout: Workout, blockId: string, direction: 1 | -1): Promise<number>
    moveLiveBlock(workout: Workout, blockId: string, targetIndex: number, operationId: string): Promise<number>
    mergeLiveBlockWithNext(workout: Workout, blockId: string, preset: "set" | "circuit"): Promise<number>
    setExerciseComment(workout: Workout, exerciseId: string, comment: string): Promise<number>
    setWorkoutReview(workout: Workout, response: WorkoutTrainerResponseDraft): Promise<number>
    setClientWorkoutComment(workout: Workout, comment: string): Promise<number>
    rename(workout: Workout, title: string): Promise<number>
    setActualDuration(workout: Workout, durationSec: number | null): Promise<number>
    submitFeedback(workout: Workout, feedback: WorkoutFeedbackDraft): Promise<number>
    askQuestion(workout: Workout, question: string): Promise<number>
    answerQuestion(workout: Workout, response: WorkoutQuestionAnswerDraft): Promise<number>
    resolveQuestion(workout: Workout): Promise<number>
    listTrainerAttention(): Promise<TrainerAttentionWorkout[]>
    snoozeClientAttention(clientId: string): Promise<string>
    replaceLiveExercise(workout: Workout, exerciseId: string, exercise: ExerciseSnapshot): Promise<number>
    finish(workout: Workout): Promise<number>
    setLivePause(workout: Workout, paused: boolean): Promise<number>
    remove(workout: Workout): Promise<void>
  }
  favoriteWorkouts: FavoriteWorkoutsRepository
  workoutTemplates: {
    list(): Promise<WorkoutTemplate[]>
    get(id: string): Promise<WorkoutTemplate>
    save(draft: WorkoutTemplateDraft): Promise<string>
    archive(template: WorkoutTemplate): Promise<void>
  }
  trainingSummaries: {
    firstCompletedWorkoutDate(clientId: string): Promise<LocalDate | null>
    listForTrainer(clientId: string): Promise<TrainingSummary[]>
    listForClient(clientId: string): Promise<PublishedTrainingSummary[]>
    generate(clientId: string, periodStart: string, periodEnd: string, force?: boolean, triggerReason?: TrainingSummaryTriggerReason): Promise<{
      generatedAt: string
      cached: boolean
    }>
    publish(summary: TrainingSummary, clientCopy: ClientTrainingSummary): Promise<void>
    unpublish(summary: TrainingSummary): Promise<void>
  }
  trainerProfiles: TrainerProfilesRepository
  trainerDiscovery: TrainerDiscoveryRepository
  trainerWorkspace: {
    read(): Promise<TrainerWorkspace>
  }
  trainerFinance: TrainerFinanceRepository
  clientFinance: ClientFinanceRepository
  athleteSportProfile: AthleteSportProfileRepository
  nutrition: NutritionRepository
  appFeedback: {
    submit(kind: AppFeedbackKind, message: string, metadata?: Pick<AppFeedbackInput, "modelInputJson" | "modelOutputJson">): Promise<string>
  }
  pushNotifications: {
    status(userId: string): Promise<NotificationStatus>
    enable(userId: string): Promise<void>
    setCategoryEnabled(userId: string, kind: string, enabled: boolean): Promise<void>
    sendTestPush(endpoint: string): Promise<void>
    disable(userId: string): Promise<void>
  }
  realtime: {
    subscribeToClientChanges: (clientId: string, onChange: (change: ClientRealtimeChange) => void, onReady?: () => void) => () => void
  }
}
