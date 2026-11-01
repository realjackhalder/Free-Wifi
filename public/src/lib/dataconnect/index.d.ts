import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;


export enum SlipStatus {
  PENDING = "PENDING",
  VERIFIED = "VERIFIED",
  REJECTED = "REJECTED",
  DUPLICATE = "DUPLICATE",
};

export enum UserRole {
  USER = "USER",
  ADMIN = "ADMIN",
};



export interface CheckIpAccessData {
  users: ({
    uid: string;
    email: string;
    name?: string | null;
    plan: string;
    expiresAt: TimestampString;
    activeIp?: string | null;
    isBlocked: boolean;
  } & User_Key)[];
}

export interface CheckIpAccessVariables {
  ip: string;
}

export interface CheckSlipUsedData {
  slips: ({
    id: UUIDString;
    status: SlipStatus;
    uploadedAt: TimestampString;
  } & Slip_Key)[];
}

export interface CheckSlipUsedVariables {
  qrPayload: string;
}

export interface ExtendUserAccessData {
  user_update?: User_Key | null;
}

export interface ExtendUserAccessVariables {
  uid: string;
  expiresAt: TimestampString;
  lastTrialAt?: TimestampString | null;
  plan?: string | null;
  activeIp?: string | null;
  activeMac?: string | null;
}

export interface GetMyProfileData {
  user?: {
    uid: string;
    email: string;
    name?: string | null;
    picture?: string | null;
    role: UserRole;
    plan: string;
    expiresAt: TimestampString;
    lastTrialAt?: TimestampString | null;
    activeIp?: string | null;
    activeMac?: string | null;
    isBlocked: boolean;
    createdAt: TimestampString;
  } & User_Key;
}

export interface GetSettingData {
  setting?: {
    key: string;
    value: string;
    description?: string | null;
    updatedAt: TimestampString;
  } & Setting_Key;
}

export interface GetSettingVariables {
  key: string;
}

export interface IpLog_Key {
  id: UUIDString;
  __typename?: 'IpLog_Key';
}

export interface ListRecentLogsData {
  ipLogs: ({
    id: UUIDString;
    email?: string | null;
    ipAddress: string;
    macAddress?: string | null;
    action: string;
    timestamp: TimestampString;
  } & IpLog_Key)[];
}

export interface ListRecentLogsVariables {
  limit?: number | null;
}

export interface ListSlipsData {
  slips: ({
    id: UUIDString;
    email: string;
    ipAddress: string;
    macAddress?: string | null;
    filename: string;
    cloudUrl?: string | null;
    qrPayload: string;
    amount: number;
    status: SlipStatus;
    uploadedAt: TimestampString;
    user?: {
      uid: string;
      name?: string | null;
      plan: string;
    } & User_Key;
  } & Slip_Key)[];
}

export interface ListSlipsVariables {
  limit?: number | null;
}

export interface ListUsersData {
  users: ({
    uid: string;
    email: string;
    name?: string | null;
    picture?: string | null;
    role: UserRole;
    plan: string;
    expiresAt: TimestampString;
    lastTrialAt?: TimestampString | null;
    activeIp?: string | null;
    activeMac?: string | null;
    isBlocked: boolean;
    createdAt: TimestampString;
  } & User_Key)[];
}

export interface ListUsersVariables {
  limit?: number | null;
}

export interface ListVpnPeersData {
  vpnPeers: ({
    id: UUIDString;
    phone?: string | null;
    label: string;
    clientIp: string;
    publicKey: string;
    enabled: boolean;
    createdAt: TimestampString;
    user?: {
      email: string;
      name?: string | null;
    };
  } & VpnPeer_Key)[];
}

export interface LogIpActionData {
  ipLog_insert: IpLog_Key;
}

export interface LogIpActionVariables {
  email?: string | null;
  ipAddress: string;
  macAddress?: string | null;
  action: string;
}

export interface OtpVerification_Key {
  id: UUIDString;
  __typename?: 'OtpVerification_Key';
}

export interface RecordSlipData {
  slip_insert: Slip_Key;
}

export interface RecordSlipVariables {
  email: string;
  ipAddress: string;
  macAddress?: string | null;
  filename: string;
  cloudUrl?: string | null;
  qrPayload: string;
  amount: number;
}

export interface RegisterVpnPeerData {
  vpnPeer_insert: VpnPeer_Key;
}

export interface RegisterVpnPeerVariables {
  phone?: string | null;
  label: string;
  clientIp: string;
  publicKey: string;
}

export interface SetSettingData {
  setting_upsert: Setting_Key;
}

export interface SetSettingVariables {
  key: string;
  value: string;
  description?: string | null;
}

export interface SetVpnPeerEnabledData {
  vpnPeer_update?: VpnPeer_Key | null;
}

export interface SetVpnPeerEnabledVariables {
  id: UUIDString;
  enabled: boolean;
}

export interface Setting_Key {
  key: string;
  __typename?: 'Setting_Key';
}

export interface Slip_Key {
  id: UUIDString;
  __typename?: 'Slip_Key';
}

export interface UpdateSlipStatusData {
  slip_update?: Slip_Key | null;
}

export interface UpdateSlipStatusVariables {
  id: UUIDString;
  status: SlipStatus;
}

export interface UpsertCurrentUserData {
  user_upsert: User_Key;
}

export interface UpsertCurrentUserVariables {
  email: string;
  name?: string | null;
  picture?: string | null;
  googleId?: string | null;
  activeIp?: string | null;
  activeMac?: string | null;
  expiresAt: TimestampString;
}

export interface User_Key {
  uid: string;
  __typename?: 'User_Key';
}

export interface VpnPeer_Key {
  id: UUIDString;
  __typename?: 'VpnPeer_Key';
}

interface UpsertCurrentUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertCurrentUserVariables): MutationRef<UpsertCurrentUserData, UpsertCurrentUserVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpsertCurrentUserVariables): MutationRef<UpsertCurrentUserData, UpsertCurrentUserVariables>;
  operationName: string;
}
export const upsertCurrentUserRef: UpsertCurrentUserRef;

export function upsertCurrentUser(vars: UpsertCurrentUserVariables): MutationPromise<UpsertCurrentUserData, UpsertCurrentUserVariables>;
export function upsertCurrentUser(dc: DataConnect, vars: UpsertCurrentUserVariables): MutationPromise<UpsertCurrentUserData, UpsertCurrentUserVariables>;

interface ExtendUserAccessRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ExtendUserAccessVariables): MutationRef<ExtendUserAccessData, ExtendUserAccessVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ExtendUserAccessVariables): MutationRef<ExtendUserAccessData, ExtendUserAccessVariables>;
  operationName: string;
}
export const extendUserAccessRef: ExtendUserAccessRef;

export function extendUserAccess(vars: ExtendUserAccessVariables): MutationPromise<ExtendUserAccessData, ExtendUserAccessVariables>;
export function extendUserAccess(dc: DataConnect, vars: ExtendUserAccessVariables): MutationPromise<ExtendUserAccessData, ExtendUserAccessVariables>;

interface RecordSlipRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: RecordSlipVariables): MutationRef<RecordSlipData, RecordSlipVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: RecordSlipVariables): MutationRef<RecordSlipData, RecordSlipVariables>;
  operationName: string;
}
export const recordSlipRef: RecordSlipRef;

export function recordSlip(vars: RecordSlipVariables): MutationPromise<RecordSlipData, RecordSlipVariables>;
export function recordSlip(dc: DataConnect, vars: RecordSlipVariables): MutationPromise<RecordSlipData, RecordSlipVariables>;

interface UpdateSlipStatusRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateSlipStatusVariables): MutationRef<UpdateSlipStatusData, UpdateSlipStatusVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateSlipStatusVariables): MutationRef<UpdateSlipStatusData, UpdateSlipStatusVariables>;
  operationName: string;
}
export const updateSlipStatusRef: UpdateSlipStatusRef;

export function updateSlipStatus(vars: UpdateSlipStatusVariables): MutationPromise<UpdateSlipStatusData, UpdateSlipStatusVariables>;
export function updateSlipStatus(dc: DataConnect, vars: UpdateSlipStatusVariables): MutationPromise<UpdateSlipStatusData, UpdateSlipStatusVariables>;

interface LogIpActionRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: LogIpActionVariables): MutationRef<LogIpActionData, LogIpActionVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: LogIpActionVariables): MutationRef<LogIpActionData, LogIpActionVariables>;
  operationName: string;
}
export const logIpActionRef: LogIpActionRef;

export function logIpAction(vars: LogIpActionVariables): MutationPromise<LogIpActionData, LogIpActionVariables>;
export function logIpAction(dc: DataConnect, vars: LogIpActionVariables): MutationPromise<LogIpActionData, LogIpActionVariables>;

interface SetSettingRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: SetSettingVariables): MutationRef<SetSettingData, SetSettingVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: SetSettingVariables): MutationRef<SetSettingData, SetSettingVariables>;
  operationName: string;
}
export const setSettingRef: SetSettingRef;

export function setSetting(vars: SetSettingVariables): MutationPromise<SetSettingData, SetSettingVariables>;
export function setSetting(dc: DataConnect, vars: SetSettingVariables): MutationPromise<SetSettingData, SetSettingVariables>;

interface RegisterVpnPeerRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: RegisterVpnPeerVariables): MutationRef<RegisterVpnPeerData, RegisterVpnPeerVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: RegisterVpnPeerVariables): MutationRef<RegisterVpnPeerData, RegisterVpnPeerVariables>;
  operationName: string;
}
export const registerVpnPeerRef: RegisterVpnPeerRef;

export function registerVpnPeer(vars: RegisterVpnPeerVariables): MutationPromise<RegisterVpnPeerData, RegisterVpnPeerVariables>;
export function registerVpnPeer(dc: DataConnect, vars: RegisterVpnPeerVariables): MutationPromise<RegisterVpnPeerData, RegisterVpnPeerVariables>;

interface SetVpnPeerEnabledRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: SetVpnPeerEnabledVariables): MutationRef<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: SetVpnPeerEnabledVariables): MutationRef<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;
  operationName: string;
}
export const setVpnPeerEnabledRef: SetVpnPeerEnabledRef;

export function setVpnPeerEnabled(vars: SetVpnPeerEnabledVariables): MutationPromise<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;
export function setVpnPeerEnabled(dc: DataConnect, vars: SetVpnPeerEnabledVariables): MutationPromise<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;

interface GetMyProfileRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetMyProfileData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<GetMyProfileData, undefined>;
  operationName: string;
}
export const getMyProfileRef: GetMyProfileRef;

export function getMyProfile(options?: ExecuteQueryOptions): QueryPromise<GetMyProfileData, undefined>;
export function getMyProfile(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetMyProfileData, undefined>;

interface CheckIpAccessRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CheckIpAccessVariables): QueryRef<CheckIpAccessData, CheckIpAccessVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CheckIpAccessVariables): QueryRef<CheckIpAccessData, CheckIpAccessVariables>;
  operationName: string;
}
export const checkIpAccessRef: CheckIpAccessRef;

export function checkIpAccess(vars: CheckIpAccessVariables, options?: ExecuteQueryOptions): QueryPromise<CheckIpAccessData, CheckIpAccessVariables>;
export function checkIpAccess(dc: DataConnect, vars: CheckIpAccessVariables, options?: ExecuteQueryOptions): QueryPromise<CheckIpAccessData, CheckIpAccessVariables>;

interface ListUsersRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars?: ListUsersVariables): QueryRef<ListUsersData, ListUsersVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars?: ListUsersVariables): QueryRef<ListUsersData, ListUsersVariables>;
  operationName: string;
}
export const listUsersRef: ListUsersRef;

export function listUsers(vars?: ListUsersVariables, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, ListUsersVariables>;
export function listUsers(dc: DataConnect, vars?: ListUsersVariables, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, ListUsersVariables>;

interface CheckSlipUsedRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CheckSlipUsedVariables): QueryRef<CheckSlipUsedData, CheckSlipUsedVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CheckSlipUsedVariables): QueryRef<CheckSlipUsedData, CheckSlipUsedVariables>;
  operationName: string;
}
export const checkSlipUsedRef: CheckSlipUsedRef;

export function checkSlipUsed(vars: CheckSlipUsedVariables, options?: ExecuteQueryOptions): QueryPromise<CheckSlipUsedData, CheckSlipUsedVariables>;
export function checkSlipUsed(dc: DataConnect, vars: CheckSlipUsedVariables, options?: ExecuteQueryOptions): QueryPromise<CheckSlipUsedData, CheckSlipUsedVariables>;

interface ListSlipsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars?: ListSlipsVariables): QueryRef<ListSlipsData, ListSlipsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars?: ListSlipsVariables): QueryRef<ListSlipsData, ListSlipsVariables>;
  operationName: string;
}
export const listSlipsRef: ListSlipsRef;

export function listSlips(vars?: ListSlipsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSlipsData, ListSlipsVariables>;
export function listSlips(dc: DataConnect, vars?: ListSlipsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSlipsData, ListSlipsVariables>;

interface GetSettingRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetSettingVariables): QueryRef<GetSettingData, GetSettingVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetSettingVariables): QueryRef<GetSettingData, GetSettingVariables>;
  operationName: string;
}
export const getSettingRef: GetSettingRef;

export function getSetting(vars: GetSettingVariables, options?: ExecuteQueryOptions): QueryPromise<GetSettingData, GetSettingVariables>;
export function getSetting(dc: DataConnect, vars: GetSettingVariables, options?: ExecuteQueryOptions): QueryPromise<GetSettingData, GetSettingVariables>;

interface ListRecentLogsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars?: ListRecentLogsVariables): QueryRef<ListRecentLogsData, ListRecentLogsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars?: ListRecentLogsVariables): QueryRef<ListRecentLogsData, ListRecentLogsVariables>;
  operationName: string;
}
export const listRecentLogsRef: ListRecentLogsRef;

export function listRecentLogs(vars?: ListRecentLogsVariables, options?: ExecuteQueryOptions): QueryPromise<ListRecentLogsData, ListRecentLogsVariables>;
export function listRecentLogs(dc: DataConnect, vars?: ListRecentLogsVariables, options?: ExecuteQueryOptions): QueryPromise<ListRecentLogsData, ListRecentLogsVariables>;

interface ListVpnPeersRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListVpnPeersData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListVpnPeersData, undefined>;
  operationName: string;
}
export const listVpnPeersRef: ListVpnPeersRef;

export function listVpnPeers(options?: ExecuteQueryOptions): QueryPromise<ListVpnPeersData, undefined>;
export function listVpnPeers(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListVpnPeersData, undefined>;

