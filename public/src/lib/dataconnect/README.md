# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `default`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*GetMyProfile*](#getmyprofile)
  - [*CheckIpAccess*](#checkipaccess)
  - [*ListUsers*](#listusers)
  - [*CheckSlipUsed*](#checkslipused)
  - [*ListSlips*](#listslips)
  - [*GetSetting*](#getsetting)
  - [*ListRecentLogs*](#listrecentlogs)
  - [*ListVpnPeers*](#listvpnpeers)
- [**Mutations**](#mutations)
  - [*UpsertCurrentUser*](#upsertcurrentuser)
  - [*ExtendUserAccess*](#extenduseraccess)
  - [*RecordSlip*](#recordslip)
  - [*UpdateSlipStatus*](#updateslipstatus)
  - [*LogIpAction*](#logipaction)
  - [*SetSetting*](#setsetting)
  - [*RegisterVpnPeer*](#registervpnpeer)
  - [*SetVpnPeerEnabled*](#setvpnpeerenabled)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `default`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@free-wifi/dataconnect` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@free-wifi/dataconnect';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@free-wifi/dataconnect';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `default` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## GetMyProfile
You can execute the `GetMyProfile` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
getMyProfile(options?: ExecuteQueryOptions): QueryPromise<GetMyProfileData, undefined>;

interface GetMyProfileRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetMyProfileData, undefined>;
}
export const getMyProfileRef: GetMyProfileRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getMyProfile(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetMyProfileData, undefined>;

interface GetMyProfileRef {
  ...
  (dc: DataConnect): QueryRef<GetMyProfileData, undefined>;
}
export const getMyProfileRef: GetMyProfileRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getMyProfileRef:
```typescript
const name = getMyProfileRef.operationName;
console.log(name);
```

### Variables
The `GetMyProfile` query has no variables.
### Return Type
Recall that executing the `GetMyProfile` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetMyProfileData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetMyProfile`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getMyProfile } from '@free-wifi/dataconnect';


// Call the `getMyProfile()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getMyProfile();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getMyProfile(dataConnect);

console.log(data.user);

// Or, you can use the `Promise` API.
getMyProfile().then((response) => {
  const data = response.data;
  console.log(data.user);
});
```

### Using `GetMyProfile`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getMyProfileRef } from '@free-wifi/dataconnect';


// Call the `getMyProfileRef()` function to get a reference to the query.
const ref = getMyProfileRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getMyProfileRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.user);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.user);
});
```

## CheckIpAccess
You can execute the `CheckIpAccess` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
checkIpAccess(vars: CheckIpAccessVariables, options?: ExecuteQueryOptions): QueryPromise<CheckIpAccessData, CheckIpAccessVariables>;

interface CheckIpAccessRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CheckIpAccessVariables): QueryRef<CheckIpAccessData, CheckIpAccessVariables>;
}
export const checkIpAccessRef: CheckIpAccessRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
checkIpAccess(dc: DataConnect, vars: CheckIpAccessVariables, options?: ExecuteQueryOptions): QueryPromise<CheckIpAccessData, CheckIpAccessVariables>;

interface CheckIpAccessRef {
  ...
  (dc: DataConnect, vars: CheckIpAccessVariables): QueryRef<CheckIpAccessData, CheckIpAccessVariables>;
}
export const checkIpAccessRef: CheckIpAccessRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the checkIpAccessRef:
```typescript
const name = checkIpAccessRef.operationName;
console.log(name);
```

### Variables
The `CheckIpAccess` query requires an argument of type `CheckIpAccessVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CheckIpAccessVariables {
  ip: string;
}
```
### Return Type
Recall that executing the `CheckIpAccess` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CheckIpAccessData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `CheckIpAccess`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, checkIpAccess, CheckIpAccessVariables } from '@free-wifi/dataconnect';

// The `CheckIpAccess` query requires an argument of type `CheckIpAccessVariables`:
const checkIpAccessVars: CheckIpAccessVariables = {
  ip: ..., 
};

// Call the `checkIpAccess()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await checkIpAccess(checkIpAccessVars);
// Variables can be defined inline as well.
const { data } = await checkIpAccess({ ip: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await checkIpAccess(dataConnect, checkIpAccessVars);

console.log(data.users);

// Or, you can use the `Promise` API.
checkIpAccess(checkIpAccessVars).then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

### Using `CheckIpAccess`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, checkIpAccessRef, CheckIpAccessVariables } from '@free-wifi/dataconnect';

// The `CheckIpAccess` query requires an argument of type `CheckIpAccessVariables`:
const checkIpAccessVars: CheckIpAccessVariables = {
  ip: ..., 
};

// Call the `checkIpAccessRef()` function to get a reference to the query.
const ref = checkIpAccessRef(checkIpAccessVars);
// Variables can be defined inline as well.
const ref = checkIpAccessRef({ ip: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = checkIpAccessRef(dataConnect, checkIpAccessVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.users);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

## ListUsers
You can execute the `ListUsers` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
listUsers(vars?: ListUsersVariables, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, ListUsersVariables>;

interface ListUsersRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars?: ListUsersVariables): QueryRef<ListUsersData, ListUsersVariables>;
}
export const listUsersRef: ListUsersRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listUsers(dc: DataConnect, vars?: ListUsersVariables, options?: ExecuteQueryOptions): QueryPromise<ListUsersData, ListUsersVariables>;

interface ListUsersRef {
  ...
  (dc: DataConnect, vars?: ListUsersVariables): QueryRef<ListUsersData, ListUsersVariables>;
}
export const listUsersRef: ListUsersRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listUsersRef:
```typescript
const name = listUsersRef.operationName;
console.log(name);
```

### Variables
The `ListUsers` query has an optional argument of type `ListUsersVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListUsersVariables {
  limit?: number | null;
}
```
### Return Type
Recall that executing the `ListUsers` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListUsersData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListUsers`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listUsers, ListUsersVariables } from '@free-wifi/dataconnect';

// The `ListUsers` query has an optional argument of type `ListUsersVariables`:
const listUsersVars: ListUsersVariables = {
  limit: ..., // optional
};

// Call the `listUsers()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listUsers(listUsersVars);
// Variables can be defined inline as well.
const { data } = await listUsers({ limit: ..., });
// Since all variables are optional for this query, you can omit the `ListUsersVariables` argument.
const { data } = await listUsers();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listUsers(dataConnect, listUsersVars);

console.log(data.users);

// Or, you can use the `Promise` API.
listUsers(listUsersVars).then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

### Using `ListUsers`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listUsersRef, ListUsersVariables } from '@free-wifi/dataconnect';

// The `ListUsers` query has an optional argument of type `ListUsersVariables`:
const listUsersVars: ListUsersVariables = {
  limit: ..., // optional
};

// Call the `listUsersRef()` function to get a reference to the query.
const ref = listUsersRef(listUsersVars);
// Variables can be defined inline as well.
const ref = listUsersRef({ limit: ..., });
// Since all variables are optional for this query, you can omit the `ListUsersVariables` argument.
const ref = listUsersRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listUsersRef(dataConnect, listUsersVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.users);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.users);
});
```

## CheckSlipUsed
You can execute the `CheckSlipUsed` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
checkSlipUsed(vars: CheckSlipUsedVariables, options?: ExecuteQueryOptions): QueryPromise<CheckSlipUsedData, CheckSlipUsedVariables>;

interface CheckSlipUsedRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CheckSlipUsedVariables): QueryRef<CheckSlipUsedData, CheckSlipUsedVariables>;
}
export const checkSlipUsedRef: CheckSlipUsedRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
checkSlipUsed(dc: DataConnect, vars: CheckSlipUsedVariables, options?: ExecuteQueryOptions): QueryPromise<CheckSlipUsedData, CheckSlipUsedVariables>;

interface CheckSlipUsedRef {
  ...
  (dc: DataConnect, vars: CheckSlipUsedVariables): QueryRef<CheckSlipUsedData, CheckSlipUsedVariables>;
}
export const checkSlipUsedRef: CheckSlipUsedRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the checkSlipUsedRef:
```typescript
const name = checkSlipUsedRef.operationName;
console.log(name);
```

### Variables
The `CheckSlipUsed` query requires an argument of type `CheckSlipUsedVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CheckSlipUsedVariables {
  qrPayload: string;
}
```
### Return Type
Recall that executing the `CheckSlipUsed` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CheckSlipUsedData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CheckSlipUsedData {
  slips: ({
    id: UUIDString;
    status: SlipStatus;
    uploadedAt: TimestampString;
  } & Slip_Key)[];
}
```
### Using `CheckSlipUsed`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, checkSlipUsed, CheckSlipUsedVariables } from '@free-wifi/dataconnect';

// The `CheckSlipUsed` query requires an argument of type `CheckSlipUsedVariables`:
const checkSlipUsedVars: CheckSlipUsedVariables = {
  qrPayload: ..., 
};

// Call the `checkSlipUsed()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await checkSlipUsed(checkSlipUsedVars);
// Variables can be defined inline as well.
const { data } = await checkSlipUsed({ qrPayload: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await checkSlipUsed(dataConnect, checkSlipUsedVars);

console.log(data.slips);

// Or, you can use the `Promise` API.
checkSlipUsed(checkSlipUsedVars).then((response) => {
  const data = response.data;
  console.log(data.slips);
});
```

### Using `CheckSlipUsed`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, checkSlipUsedRef, CheckSlipUsedVariables } from '@free-wifi/dataconnect';

// The `CheckSlipUsed` query requires an argument of type `CheckSlipUsedVariables`:
const checkSlipUsedVars: CheckSlipUsedVariables = {
  qrPayload: ..., 
};

// Call the `checkSlipUsedRef()` function to get a reference to the query.
const ref = checkSlipUsedRef(checkSlipUsedVars);
// Variables can be defined inline as well.
const ref = checkSlipUsedRef({ qrPayload: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = checkSlipUsedRef(dataConnect, checkSlipUsedVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.slips);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.slips);
});
```

## ListSlips
You can execute the `ListSlips` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
listSlips(vars?: ListSlipsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSlipsData, ListSlipsVariables>;

interface ListSlipsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars?: ListSlipsVariables): QueryRef<ListSlipsData, ListSlipsVariables>;
}
export const listSlipsRef: ListSlipsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listSlips(dc: DataConnect, vars?: ListSlipsVariables, options?: ExecuteQueryOptions): QueryPromise<ListSlipsData, ListSlipsVariables>;

interface ListSlipsRef {
  ...
  (dc: DataConnect, vars?: ListSlipsVariables): QueryRef<ListSlipsData, ListSlipsVariables>;
}
export const listSlipsRef: ListSlipsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listSlipsRef:
```typescript
const name = listSlipsRef.operationName;
console.log(name);
```

### Variables
The `ListSlips` query has an optional argument of type `ListSlipsVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListSlipsVariables {
  limit?: number | null;
}
```
### Return Type
Recall that executing the `ListSlips` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListSlipsData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListSlips`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listSlips, ListSlipsVariables } from '@free-wifi/dataconnect';

// The `ListSlips` query has an optional argument of type `ListSlipsVariables`:
const listSlipsVars: ListSlipsVariables = {
  limit: ..., // optional
};

// Call the `listSlips()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listSlips(listSlipsVars);
// Variables can be defined inline as well.
const { data } = await listSlips({ limit: ..., });
// Since all variables are optional for this query, you can omit the `ListSlipsVariables` argument.
const { data } = await listSlips();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listSlips(dataConnect, listSlipsVars);

console.log(data.slips);

// Or, you can use the `Promise` API.
listSlips(listSlipsVars).then((response) => {
  const data = response.data;
  console.log(data.slips);
});
```

### Using `ListSlips`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listSlipsRef, ListSlipsVariables } from '@free-wifi/dataconnect';

// The `ListSlips` query has an optional argument of type `ListSlipsVariables`:
const listSlipsVars: ListSlipsVariables = {
  limit: ..., // optional
};

// Call the `listSlipsRef()` function to get a reference to the query.
const ref = listSlipsRef(listSlipsVars);
// Variables can be defined inline as well.
const ref = listSlipsRef({ limit: ..., });
// Since all variables are optional for this query, you can omit the `ListSlipsVariables` argument.
const ref = listSlipsRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listSlipsRef(dataConnect, listSlipsVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.slips);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.slips);
});
```

## GetSetting
You can execute the `GetSetting` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
getSetting(vars: GetSettingVariables, options?: ExecuteQueryOptions): QueryPromise<GetSettingData, GetSettingVariables>;

interface GetSettingRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetSettingVariables): QueryRef<GetSettingData, GetSettingVariables>;
}
export const getSettingRef: GetSettingRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getSetting(dc: DataConnect, vars: GetSettingVariables, options?: ExecuteQueryOptions): QueryPromise<GetSettingData, GetSettingVariables>;

interface GetSettingRef {
  ...
  (dc: DataConnect, vars: GetSettingVariables): QueryRef<GetSettingData, GetSettingVariables>;
}
export const getSettingRef: GetSettingRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getSettingRef:
```typescript
const name = getSettingRef.operationName;
console.log(name);
```

### Variables
The `GetSetting` query requires an argument of type `GetSettingVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetSettingVariables {
  key: string;
}
```
### Return Type
Recall that executing the `GetSetting` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetSettingData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetSettingData {
  setting?: {
    key: string;
    value: string;
    description?: string | null;
    updatedAt: TimestampString;
  } & Setting_Key;
}
```
### Using `GetSetting`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getSetting, GetSettingVariables } from '@free-wifi/dataconnect';

// The `GetSetting` query requires an argument of type `GetSettingVariables`:
const getSettingVars: GetSettingVariables = {
  key: ..., 
};

// Call the `getSetting()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getSetting(getSettingVars);
// Variables can be defined inline as well.
const { data } = await getSetting({ key: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getSetting(dataConnect, getSettingVars);

console.log(data.setting);

// Or, you can use the `Promise` API.
getSetting(getSettingVars).then((response) => {
  const data = response.data;
  console.log(data.setting);
});
```

### Using `GetSetting`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getSettingRef, GetSettingVariables } from '@free-wifi/dataconnect';

// The `GetSetting` query requires an argument of type `GetSettingVariables`:
const getSettingVars: GetSettingVariables = {
  key: ..., 
};

// Call the `getSettingRef()` function to get a reference to the query.
const ref = getSettingRef(getSettingVars);
// Variables can be defined inline as well.
const ref = getSettingRef({ key: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getSettingRef(dataConnect, getSettingVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.setting);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.setting);
});
```

## ListRecentLogs
You can execute the `ListRecentLogs` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
listRecentLogs(vars?: ListRecentLogsVariables, options?: ExecuteQueryOptions): QueryPromise<ListRecentLogsData, ListRecentLogsVariables>;

interface ListRecentLogsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars?: ListRecentLogsVariables): QueryRef<ListRecentLogsData, ListRecentLogsVariables>;
}
export const listRecentLogsRef: ListRecentLogsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listRecentLogs(dc: DataConnect, vars?: ListRecentLogsVariables, options?: ExecuteQueryOptions): QueryPromise<ListRecentLogsData, ListRecentLogsVariables>;

interface ListRecentLogsRef {
  ...
  (dc: DataConnect, vars?: ListRecentLogsVariables): QueryRef<ListRecentLogsData, ListRecentLogsVariables>;
}
export const listRecentLogsRef: ListRecentLogsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listRecentLogsRef:
```typescript
const name = listRecentLogsRef.operationName;
console.log(name);
```

### Variables
The `ListRecentLogs` query has an optional argument of type `ListRecentLogsVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListRecentLogsVariables {
  limit?: number | null;
}
```
### Return Type
Recall that executing the `ListRecentLogs` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListRecentLogsData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListRecentLogs`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listRecentLogs, ListRecentLogsVariables } from '@free-wifi/dataconnect';

// The `ListRecentLogs` query has an optional argument of type `ListRecentLogsVariables`:
const listRecentLogsVars: ListRecentLogsVariables = {
  limit: ..., // optional
};

// Call the `listRecentLogs()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listRecentLogs(listRecentLogsVars);
// Variables can be defined inline as well.
const { data } = await listRecentLogs({ limit: ..., });
// Since all variables are optional for this query, you can omit the `ListRecentLogsVariables` argument.
const { data } = await listRecentLogs();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listRecentLogs(dataConnect, listRecentLogsVars);

console.log(data.ipLogs);

// Or, you can use the `Promise` API.
listRecentLogs(listRecentLogsVars).then((response) => {
  const data = response.data;
  console.log(data.ipLogs);
});
```

### Using `ListRecentLogs`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listRecentLogsRef, ListRecentLogsVariables } from '@free-wifi/dataconnect';

// The `ListRecentLogs` query has an optional argument of type `ListRecentLogsVariables`:
const listRecentLogsVars: ListRecentLogsVariables = {
  limit: ..., // optional
};

// Call the `listRecentLogsRef()` function to get a reference to the query.
const ref = listRecentLogsRef(listRecentLogsVars);
// Variables can be defined inline as well.
const ref = listRecentLogsRef({ limit: ..., });
// Since all variables are optional for this query, you can omit the `ListRecentLogsVariables` argument.
const ref = listRecentLogsRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listRecentLogsRef(dataConnect, listRecentLogsVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.ipLogs);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.ipLogs);
});
```

## ListVpnPeers
You can execute the `ListVpnPeers` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
listVpnPeers(options?: ExecuteQueryOptions): QueryPromise<ListVpnPeersData, undefined>;

interface ListVpnPeersRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListVpnPeersData, undefined>;
}
export const listVpnPeersRef: ListVpnPeersRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listVpnPeers(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListVpnPeersData, undefined>;

interface ListVpnPeersRef {
  ...
  (dc: DataConnect): QueryRef<ListVpnPeersData, undefined>;
}
export const listVpnPeersRef: ListVpnPeersRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listVpnPeersRef:
```typescript
const name = listVpnPeersRef.operationName;
console.log(name);
```

### Variables
The `ListVpnPeers` query has no variables.
### Return Type
Recall that executing the `ListVpnPeers` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListVpnPeersData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListVpnPeers`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listVpnPeers } from '@free-wifi/dataconnect';


// Call the `listVpnPeers()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listVpnPeers();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listVpnPeers(dataConnect);

console.log(data.vpnPeers);

// Or, you can use the `Promise` API.
listVpnPeers().then((response) => {
  const data = response.data;
  console.log(data.vpnPeers);
});
```

### Using `ListVpnPeers`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listVpnPeersRef } from '@free-wifi/dataconnect';


// Call the `listVpnPeersRef()` function to get a reference to the query.
const ref = listVpnPeersRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listVpnPeersRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.vpnPeers);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.vpnPeers);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `default` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## UpsertCurrentUser
You can execute the `UpsertCurrentUser` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
upsertCurrentUser(vars: UpsertCurrentUserVariables): MutationPromise<UpsertCurrentUserData, UpsertCurrentUserVariables>;

interface UpsertCurrentUserRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertCurrentUserVariables): MutationRef<UpsertCurrentUserData, UpsertCurrentUserVariables>;
}
export const upsertCurrentUserRef: UpsertCurrentUserRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
upsertCurrentUser(dc: DataConnect, vars: UpsertCurrentUserVariables): MutationPromise<UpsertCurrentUserData, UpsertCurrentUserVariables>;

interface UpsertCurrentUserRef {
  ...
  (dc: DataConnect, vars: UpsertCurrentUserVariables): MutationRef<UpsertCurrentUserData, UpsertCurrentUserVariables>;
}
export const upsertCurrentUserRef: UpsertCurrentUserRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the upsertCurrentUserRef:
```typescript
const name = upsertCurrentUserRef.operationName;
console.log(name);
```

### Variables
The `UpsertCurrentUser` mutation requires an argument of type `UpsertCurrentUserVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpsertCurrentUserVariables {
  email: string;
  name?: string | null;
  picture?: string | null;
  googleId?: string | null;
  activeIp?: string | null;
  activeMac?: string | null;
  expiresAt: TimestampString;
}
```
### Return Type
Recall that executing the `UpsertCurrentUser` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpsertCurrentUserData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpsertCurrentUserData {
  user_upsert: User_Key;
}
```
### Using `UpsertCurrentUser`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, upsertCurrentUser, UpsertCurrentUserVariables } from '@free-wifi/dataconnect';

// The `UpsertCurrentUser` mutation requires an argument of type `UpsertCurrentUserVariables`:
const upsertCurrentUserVars: UpsertCurrentUserVariables = {
  email: ..., 
  name: ..., // optional
  picture: ..., // optional
  googleId: ..., // optional
  activeIp: ..., // optional
  activeMac: ..., // optional
  expiresAt: ..., 
};

// Call the `upsertCurrentUser()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await upsertCurrentUser(upsertCurrentUserVars);
// Variables can be defined inline as well.
const { data } = await upsertCurrentUser({ email: ..., name: ..., picture: ..., googleId: ..., activeIp: ..., activeMac: ..., expiresAt: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await upsertCurrentUser(dataConnect, upsertCurrentUserVars);

console.log(data.user_upsert);

// Or, you can use the `Promise` API.
upsertCurrentUser(upsertCurrentUserVars).then((response) => {
  const data = response.data;
  console.log(data.user_upsert);
});
```

### Using `UpsertCurrentUser`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, upsertCurrentUserRef, UpsertCurrentUserVariables } from '@free-wifi/dataconnect';

// The `UpsertCurrentUser` mutation requires an argument of type `UpsertCurrentUserVariables`:
const upsertCurrentUserVars: UpsertCurrentUserVariables = {
  email: ..., 
  name: ..., // optional
  picture: ..., // optional
  googleId: ..., // optional
  activeIp: ..., // optional
  activeMac: ..., // optional
  expiresAt: ..., 
};

// Call the `upsertCurrentUserRef()` function to get a reference to the mutation.
const ref = upsertCurrentUserRef(upsertCurrentUserVars);
// Variables can be defined inline as well.
const ref = upsertCurrentUserRef({ email: ..., name: ..., picture: ..., googleId: ..., activeIp: ..., activeMac: ..., expiresAt: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = upsertCurrentUserRef(dataConnect, upsertCurrentUserVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.user_upsert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.user_upsert);
});
```

## ExtendUserAccess
You can execute the `ExtendUserAccess` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
extendUserAccess(vars: ExtendUserAccessVariables): MutationPromise<ExtendUserAccessData, ExtendUserAccessVariables>;

interface ExtendUserAccessRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ExtendUserAccessVariables): MutationRef<ExtendUserAccessData, ExtendUserAccessVariables>;
}
export const extendUserAccessRef: ExtendUserAccessRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
extendUserAccess(dc: DataConnect, vars: ExtendUserAccessVariables): MutationPromise<ExtendUserAccessData, ExtendUserAccessVariables>;

interface ExtendUserAccessRef {
  ...
  (dc: DataConnect, vars: ExtendUserAccessVariables): MutationRef<ExtendUserAccessData, ExtendUserAccessVariables>;
}
export const extendUserAccessRef: ExtendUserAccessRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the extendUserAccessRef:
```typescript
const name = extendUserAccessRef.operationName;
console.log(name);
```

### Variables
The `ExtendUserAccess` mutation requires an argument of type `ExtendUserAccessVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ExtendUserAccessVariables {
  uid: string;
  expiresAt: TimestampString;
  lastTrialAt?: TimestampString | null;
  plan?: string | null;
  activeIp?: string | null;
  activeMac?: string | null;
}
```
### Return Type
Recall that executing the `ExtendUserAccess` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ExtendUserAccessData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ExtendUserAccessData {
  user_update?: User_Key | null;
}
```
### Using `ExtendUserAccess`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, extendUserAccess, ExtendUserAccessVariables } from '@free-wifi/dataconnect';

// The `ExtendUserAccess` mutation requires an argument of type `ExtendUserAccessVariables`:
const extendUserAccessVars: ExtendUserAccessVariables = {
  uid: ..., 
  expiresAt: ..., 
  lastTrialAt: ..., // optional
  plan: ..., // optional
  activeIp: ..., // optional
  activeMac: ..., // optional
};

// Call the `extendUserAccess()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await extendUserAccess(extendUserAccessVars);
// Variables can be defined inline as well.
const { data } = await extendUserAccess({ uid: ..., expiresAt: ..., lastTrialAt: ..., plan: ..., activeIp: ..., activeMac: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await extendUserAccess(dataConnect, extendUserAccessVars);

console.log(data.user_update);

// Or, you can use the `Promise` API.
extendUserAccess(extendUserAccessVars).then((response) => {
  const data = response.data;
  console.log(data.user_update);
});
```

### Using `ExtendUserAccess`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, extendUserAccessRef, ExtendUserAccessVariables } from '@free-wifi/dataconnect';

// The `ExtendUserAccess` mutation requires an argument of type `ExtendUserAccessVariables`:
const extendUserAccessVars: ExtendUserAccessVariables = {
  uid: ..., 
  expiresAt: ..., 
  lastTrialAt: ..., // optional
  plan: ..., // optional
  activeIp: ..., // optional
  activeMac: ..., // optional
};

// Call the `extendUserAccessRef()` function to get a reference to the mutation.
const ref = extendUserAccessRef(extendUserAccessVars);
// Variables can be defined inline as well.
const ref = extendUserAccessRef({ uid: ..., expiresAt: ..., lastTrialAt: ..., plan: ..., activeIp: ..., activeMac: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = extendUserAccessRef(dataConnect, extendUserAccessVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.user_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.user_update);
});
```

## RecordSlip
You can execute the `RecordSlip` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
recordSlip(vars: RecordSlipVariables): MutationPromise<RecordSlipData, RecordSlipVariables>;

interface RecordSlipRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: RecordSlipVariables): MutationRef<RecordSlipData, RecordSlipVariables>;
}
export const recordSlipRef: RecordSlipRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
recordSlip(dc: DataConnect, vars: RecordSlipVariables): MutationPromise<RecordSlipData, RecordSlipVariables>;

interface RecordSlipRef {
  ...
  (dc: DataConnect, vars: RecordSlipVariables): MutationRef<RecordSlipData, RecordSlipVariables>;
}
export const recordSlipRef: RecordSlipRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the recordSlipRef:
```typescript
const name = recordSlipRef.operationName;
console.log(name);
```

### Variables
The `RecordSlip` mutation requires an argument of type `RecordSlipVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface RecordSlipVariables {
  email: string;
  ipAddress: string;
  macAddress?: string | null;
  filename: string;
  cloudUrl?: string | null;
  qrPayload: string;
  amount: number;
}
```
### Return Type
Recall that executing the `RecordSlip` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `RecordSlipData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface RecordSlipData {
  slip_insert: Slip_Key;
}
```
### Using `RecordSlip`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, recordSlip, RecordSlipVariables } from '@free-wifi/dataconnect';

// The `RecordSlip` mutation requires an argument of type `RecordSlipVariables`:
const recordSlipVars: RecordSlipVariables = {
  email: ..., 
  ipAddress: ..., 
  macAddress: ..., // optional
  filename: ..., 
  cloudUrl: ..., // optional
  qrPayload: ..., 
  amount: ..., 
};

// Call the `recordSlip()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await recordSlip(recordSlipVars);
// Variables can be defined inline as well.
const { data } = await recordSlip({ email: ..., ipAddress: ..., macAddress: ..., filename: ..., cloudUrl: ..., qrPayload: ..., amount: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await recordSlip(dataConnect, recordSlipVars);

console.log(data.slip_insert);

// Or, you can use the `Promise` API.
recordSlip(recordSlipVars).then((response) => {
  const data = response.data;
  console.log(data.slip_insert);
});
```

### Using `RecordSlip`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, recordSlipRef, RecordSlipVariables } from '@free-wifi/dataconnect';

// The `RecordSlip` mutation requires an argument of type `RecordSlipVariables`:
const recordSlipVars: RecordSlipVariables = {
  email: ..., 
  ipAddress: ..., 
  macAddress: ..., // optional
  filename: ..., 
  cloudUrl: ..., // optional
  qrPayload: ..., 
  amount: ..., 
};

// Call the `recordSlipRef()` function to get a reference to the mutation.
const ref = recordSlipRef(recordSlipVars);
// Variables can be defined inline as well.
const ref = recordSlipRef({ email: ..., ipAddress: ..., macAddress: ..., filename: ..., cloudUrl: ..., qrPayload: ..., amount: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = recordSlipRef(dataConnect, recordSlipVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.slip_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.slip_insert);
});
```

## UpdateSlipStatus
You can execute the `UpdateSlipStatus` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
updateSlipStatus(vars: UpdateSlipStatusVariables): MutationPromise<UpdateSlipStatusData, UpdateSlipStatusVariables>;

interface UpdateSlipStatusRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateSlipStatusVariables): MutationRef<UpdateSlipStatusData, UpdateSlipStatusVariables>;
}
export const updateSlipStatusRef: UpdateSlipStatusRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updateSlipStatus(dc: DataConnect, vars: UpdateSlipStatusVariables): MutationPromise<UpdateSlipStatusData, UpdateSlipStatusVariables>;

interface UpdateSlipStatusRef {
  ...
  (dc: DataConnect, vars: UpdateSlipStatusVariables): MutationRef<UpdateSlipStatusData, UpdateSlipStatusVariables>;
}
export const updateSlipStatusRef: UpdateSlipStatusRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updateSlipStatusRef:
```typescript
const name = updateSlipStatusRef.operationName;
console.log(name);
```

### Variables
The `UpdateSlipStatus` mutation requires an argument of type `UpdateSlipStatusVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdateSlipStatusVariables {
  id: UUIDString;
  status: SlipStatus;
}
```
### Return Type
Recall that executing the `UpdateSlipStatus` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdateSlipStatusData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdateSlipStatusData {
  slip_update?: Slip_Key | null;
}
```
### Using `UpdateSlipStatus`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updateSlipStatus, UpdateSlipStatusVariables } from '@free-wifi/dataconnect';

// The `UpdateSlipStatus` mutation requires an argument of type `UpdateSlipStatusVariables`:
const updateSlipStatusVars: UpdateSlipStatusVariables = {
  id: ..., 
  status: ..., 
};

// Call the `updateSlipStatus()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updateSlipStatus(updateSlipStatusVars);
// Variables can be defined inline as well.
const { data } = await updateSlipStatus({ id: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updateSlipStatus(dataConnect, updateSlipStatusVars);

console.log(data.slip_update);

// Or, you can use the `Promise` API.
updateSlipStatus(updateSlipStatusVars).then((response) => {
  const data = response.data;
  console.log(data.slip_update);
});
```

### Using `UpdateSlipStatus`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updateSlipStatusRef, UpdateSlipStatusVariables } from '@free-wifi/dataconnect';

// The `UpdateSlipStatus` mutation requires an argument of type `UpdateSlipStatusVariables`:
const updateSlipStatusVars: UpdateSlipStatusVariables = {
  id: ..., 
  status: ..., 
};

// Call the `updateSlipStatusRef()` function to get a reference to the mutation.
const ref = updateSlipStatusRef(updateSlipStatusVars);
// Variables can be defined inline as well.
const ref = updateSlipStatusRef({ id: ..., status: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updateSlipStatusRef(dataConnect, updateSlipStatusVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.slip_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.slip_update);
});
```

## LogIpAction
You can execute the `LogIpAction` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
logIpAction(vars: LogIpActionVariables): MutationPromise<LogIpActionData, LogIpActionVariables>;

interface LogIpActionRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: LogIpActionVariables): MutationRef<LogIpActionData, LogIpActionVariables>;
}
export const logIpActionRef: LogIpActionRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
logIpAction(dc: DataConnect, vars: LogIpActionVariables): MutationPromise<LogIpActionData, LogIpActionVariables>;

interface LogIpActionRef {
  ...
  (dc: DataConnect, vars: LogIpActionVariables): MutationRef<LogIpActionData, LogIpActionVariables>;
}
export const logIpActionRef: LogIpActionRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the logIpActionRef:
```typescript
const name = logIpActionRef.operationName;
console.log(name);
```

### Variables
The `LogIpAction` mutation requires an argument of type `LogIpActionVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface LogIpActionVariables {
  email?: string | null;
  ipAddress: string;
  macAddress?: string | null;
  action: string;
}
```
### Return Type
Recall that executing the `LogIpAction` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `LogIpActionData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface LogIpActionData {
  ipLog_insert: IpLog_Key;
}
```
### Using `LogIpAction`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, logIpAction, LogIpActionVariables } from '@free-wifi/dataconnect';

// The `LogIpAction` mutation requires an argument of type `LogIpActionVariables`:
const logIpActionVars: LogIpActionVariables = {
  email: ..., // optional
  ipAddress: ..., 
  macAddress: ..., // optional
  action: ..., 
};

// Call the `logIpAction()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await logIpAction(logIpActionVars);
// Variables can be defined inline as well.
const { data } = await logIpAction({ email: ..., ipAddress: ..., macAddress: ..., action: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await logIpAction(dataConnect, logIpActionVars);

console.log(data.ipLog_insert);

// Or, you can use the `Promise` API.
logIpAction(logIpActionVars).then((response) => {
  const data = response.data;
  console.log(data.ipLog_insert);
});
```

### Using `LogIpAction`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, logIpActionRef, LogIpActionVariables } from '@free-wifi/dataconnect';

// The `LogIpAction` mutation requires an argument of type `LogIpActionVariables`:
const logIpActionVars: LogIpActionVariables = {
  email: ..., // optional
  ipAddress: ..., 
  macAddress: ..., // optional
  action: ..., 
};

// Call the `logIpActionRef()` function to get a reference to the mutation.
const ref = logIpActionRef(logIpActionVars);
// Variables can be defined inline as well.
const ref = logIpActionRef({ email: ..., ipAddress: ..., macAddress: ..., action: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = logIpActionRef(dataConnect, logIpActionVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.ipLog_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.ipLog_insert);
});
```

## SetSetting
You can execute the `SetSetting` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
setSetting(vars: SetSettingVariables): MutationPromise<SetSettingData, SetSettingVariables>;

interface SetSettingRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: SetSettingVariables): MutationRef<SetSettingData, SetSettingVariables>;
}
export const setSettingRef: SetSettingRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
setSetting(dc: DataConnect, vars: SetSettingVariables): MutationPromise<SetSettingData, SetSettingVariables>;

interface SetSettingRef {
  ...
  (dc: DataConnect, vars: SetSettingVariables): MutationRef<SetSettingData, SetSettingVariables>;
}
export const setSettingRef: SetSettingRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the setSettingRef:
```typescript
const name = setSettingRef.operationName;
console.log(name);
```

### Variables
The `SetSetting` mutation requires an argument of type `SetSettingVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface SetSettingVariables {
  key: string;
  value: string;
  description?: string | null;
}
```
### Return Type
Recall that executing the `SetSetting` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `SetSettingData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface SetSettingData {
  setting_upsert: Setting_Key;
}
```
### Using `SetSetting`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, setSetting, SetSettingVariables } from '@free-wifi/dataconnect';

// The `SetSetting` mutation requires an argument of type `SetSettingVariables`:
const setSettingVars: SetSettingVariables = {
  key: ..., 
  value: ..., 
  description: ..., // optional
};

// Call the `setSetting()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await setSetting(setSettingVars);
// Variables can be defined inline as well.
const { data } = await setSetting({ key: ..., value: ..., description: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await setSetting(dataConnect, setSettingVars);

console.log(data.setting_upsert);

// Or, you can use the `Promise` API.
setSetting(setSettingVars).then((response) => {
  const data = response.data;
  console.log(data.setting_upsert);
});
```

### Using `SetSetting`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, setSettingRef, SetSettingVariables } from '@free-wifi/dataconnect';

// The `SetSetting` mutation requires an argument of type `SetSettingVariables`:
const setSettingVars: SetSettingVariables = {
  key: ..., 
  value: ..., 
  description: ..., // optional
};

// Call the `setSettingRef()` function to get a reference to the mutation.
const ref = setSettingRef(setSettingVars);
// Variables can be defined inline as well.
const ref = setSettingRef({ key: ..., value: ..., description: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = setSettingRef(dataConnect, setSettingVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.setting_upsert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.setting_upsert);
});
```

## RegisterVpnPeer
You can execute the `RegisterVpnPeer` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
registerVpnPeer(vars: RegisterVpnPeerVariables): MutationPromise<RegisterVpnPeerData, RegisterVpnPeerVariables>;

interface RegisterVpnPeerRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: RegisterVpnPeerVariables): MutationRef<RegisterVpnPeerData, RegisterVpnPeerVariables>;
}
export const registerVpnPeerRef: RegisterVpnPeerRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
registerVpnPeer(dc: DataConnect, vars: RegisterVpnPeerVariables): MutationPromise<RegisterVpnPeerData, RegisterVpnPeerVariables>;

interface RegisterVpnPeerRef {
  ...
  (dc: DataConnect, vars: RegisterVpnPeerVariables): MutationRef<RegisterVpnPeerData, RegisterVpnPeerVariables>;
}
export const registerVpnPeerRef: RegisterVpnPeerRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the registerVpnPeerRef:
```typescript
const name = registerVpnPeerRef.operationName;
console.log(name);
```

### Variables
The `RegisterVpnPeer` mutation requires an argument of type `RegisterVpnPeerVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface RegisterVpnPeerVariables {
  phone?: string | null;
  label: string;
  clientIp: string;
  publicKey: string;
}
```
### Return Type
Recall that executing the `RegisterVpnPeer` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `RegisterVpnPeerData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface RegisterVpnPeerData {
  vpnPeer_insert: VpnPeer_Key;
}
```
### Using `RegisterVpnPeer`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, registerVpnPeer, RegisterVpnPeerVariables } from '@free-wifi/dataconnect';

// The `RegisterVpnPeer` mutation requires an argument of type `RegisterVpnPeerVariables`:
const registerVpnPeerVars: RegisterVpnPeerVariables = {
  phone: ..., // optional
  label: ..., 
  clientIp: ..., 
  publicKey: ..., 
};

// Call the `registerVpnPeer()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await registerVpnPeer(registerVpnPeerVars);
// Variables can be defined inline as well.
const { data } = await registerVpnPeer({ phone: ..., label: ..., clientIp: ..., publicKey: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await registerVpnPeer(dataConnect, registerVpnPeerVars);

console.log(data.vpnPeer_insert);

// Or, you can use the `Promise` API.
registerVpnPeer(registerVpnPeerVars).then((response) => {
  const data = response.data;
  console.log(data.vpnPeer_insert);
});
```

### Using `RegisterVpnPeer`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, registerVpnPeerRef, RegisterVpnPeerVariables } from '@free-wifi/dataconnect';

// The `RegisterVpnPeer` mutation requires an argument of type `RegisterVpnPeerVariables`:
const registerVpnPeerVars: RegisterVpnPeerVariables = {
  phone: ..., // optional
  label: ..., 
  clientIp: ..., 
  publicKey: ..., 
};

// Call the `registerVpnPeerRef()` function to get a reference to the mutation.
const ref = registerVpnPeerRef(registerVpnPeerVars);
// Variables can be defined inline as well.
const ref = registerVpnPeerRef({ phone: ..., label: ..., clientIp: ..., publicKey: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = registerVpnPeerRef(dataConnect, registerVpnPeerVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.vpnPeer_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.vpnPeer_insert);
});
```

## SetVpnPeerEnabled
You can execute the `SetVpnPeerEnabled` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect/index.d.ts](./index.d.ts):
```typescript
setVpnPeerEnabled(vars: SetVpnPeerEnabledVariables): MutationPromise<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;

interface SetVpnPeerEnabledRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: SetVpnPeerEnabledVariables): MutationRef<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;
}
export const setVpnPeerEnabledRef: SetVpnPeerEnabledRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
setVpnPeerEnabled(dc: DataConnect, vars: SetVpnPeerEnabledVariables): MutationPromise<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;

interface SetVpnPeerEnabledRef {
  ...
  (dc: DataConnect, vars: SetVpnPeerEnabledVariables): MutationRef<SetVpnPeerEnabledData, SetVpnPeerEnabledVariables>;
}
export const setVpnPeerEnabledRef: SetVpnPeerEnabledRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the setVpnPeerEnabledRef:
```typescript
const name = setVpnPeerEnabledRef.operationName;
console.log(name);
```

### Variables
The `SetVpnPeerEnabled` mutation requires an argument of type `SetVpnPeerEnabledVariables`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface SetVpnPeerEnabledVariables {
  id: UUIDString;
  enabled: boolean;
}
```
### Return Type
Recall that executing the `SetVpnPeerEnabled` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `SetVpnPeerEnabledData`, which is defined in [dataconnect/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface SetVpnPeerEnabledData {
  vpnPeer_update?: VpnPeer_Key | null;
}
```
### Using `SetVpnPeerEnabled`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, setVpnPeerEnabled, SetVpnPeerEnabledVariables } from '@free-wifi/dataconnect';

// The `SetVpnPeerEnabled` mutation requires an argument of type `SetVpnPeerEnabledVariables`:
const setVpnPeerEnabledVars: SetVpnPeerEnabledVariables = {
  id: ..., 
  enabled: ..., 
};

// Call the `setVpnPeerEnabled()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await setVpnPeerEnabled(setVpnPeerEnabledVars);
// Variables can be defined inline as well.
const { data } = await setVpnPeerEnabled({ id: ..., enabled: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await setVpnPeerEnabled(dataConnect, setVpnPeerEnabledVars);

console.log(data.vpnPeer_update);

// Or, you can use the `Promise` API.
setVpnPeerEnabled(setVpnPeerEnabledVars).then((response) => {
  const data = response.data;
  console.log(data.vpnPeer_update);
});
```

### Using `SetVpnPeerEnabled`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, setVpnPeerEnabledRef, SetVpnPeerEnabledVariables } from '@free-wifi/dataconnect';

// The `SetVpnPeerEnabled` mutation requires an argument of type `SetVpnPeerEnabledVariables`:
const setVpnPeerEnabledVars: SetVpnPeerEnabledVariables = {
  id: ..., 
  enabled: ..., 
};

// Call the `setVpnPeerEnabledRef()` function to get a reference to the mutation.
const ref = setVpnPeerEnabledRef(setVpnPeerEnabledVars);
// Variables can be defined inline as well.
const ref = setVpnPeerEnabledRef({ id: ..., enabled: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = setVpnPeerEnabledRef(dataConnect, setVpnPeerEnabledVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.vpnPeer_update);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.vpnPeer_update);
});
```

