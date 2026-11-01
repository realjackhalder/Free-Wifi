# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.





## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { upsertCurrentUser, extendUserAccess, recordSlip, updateSlipStatus, logIpAction, setSetting, registerVpnPeer, setVpnPeerEnabled, getMyProfile, checkIpAccess } from '@free-wifi/dataconnect';


// Operation UpsertCurrentUser:  For variables, look at type UpsertCurrentUserVars in ../index.d.ts
const { data } = await UpsertCurrentUser(dataConnect, upsertCurrentUserVars);

// Operation ExtendUserAccess:  For variables, look at type ExtendUserAccessVars in ../index.d.ts
const { data } = await ExtendUserAccess(dataConnect, extendUserAccessVars);

// Operation RecordSlip:  For variables, look at type RecordSlipVars in ../index.d.ts
const { data } = await RecordSlip(dataConnect, recordSlipVars);

// Operation UpdateSlipStatus:  For variables, look at type UpdateSlipStatusVars in ../index.d.ts
const { data } = await UpdateSlipStatus(dataConnect, updateSlipStatusVars);

// Operation LogIpAction:  For variables, look at type LogIpActionVars in ../index.d.ts
const { data } = await LogIpAction(dataConnect, logIpActionVars);

// Operation SetSetting:  For variables, look at type SetSettingVars in ../index.d.ts
const { data } = await SetSetting(dataConnect, setSettingVars);

// Operation RegisterVpnPeer:  For variables, look at type RegisterVpnPeerVars in ../index.d.ts
const { data } = await RegisterVpnPeer(dataConnect, registerVpnPeerVars);

// Operation SetVpnPeerEnabled:  For variables, look at type SetVpnPeerEnabledVars in ../index.d.ts
const { data } = await SetVpnPeerEnabled(dataConnect, setVpnPeerEnabledVars);

// Operation GetMyProfile: 
const { data } = await GetMyProfile(dataConnect);

// Operation CheckIpAccess:  For variables, look at type CheckIpAccessVars in ../index.d.ts
const { data } = await CheckIpAccess(dataConnect, checkIpAccessVars);


```