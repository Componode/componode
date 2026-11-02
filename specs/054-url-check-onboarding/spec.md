# Feature Specification: URL Check Onboarding Completion

**Feature Branch**: `[054-url-check-onboarding]`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "Complete the G3/P2 URL Check onboarding gaps: make create-with-checks support API authentication and optional availability targets like the regular URL Check editor; provide a supported path for an existing Component with no ComponentInstances to add its first instance and create checks without duplicating the Component; and make Editor/Admin permission boundaries clear for check setup, credential selection, and Import Agent selection."

## Clarifications

### Session 2026-11-02

- Q: Should Editors be allowed to select existing Credentials and Import Agents for URL Check setup, or should those selectors remain Admin-only? A: Keep Credential and Import Agent selectors Admin-only; Editors may manage ordinary checks and Hub setup, while Admins select Credentials and Import Agents.
- Q: Should an existing Component's first ComponentInstance be saved before the user opens the regular URL Check editor, or should the instance and first checks be created together in one atomic flow? A: Save the first instance first, then use the regular check editor; a valid instance remains if check setup later fails.

## User Scenarios & Testing

### User Story 1 - Configure a complete first URL Check (Priority: P2)

An Admin creates a new Component and its first URL Checks in one flow. The user can configure every supported field needed for a valid check, including API authentication and an optional availability target and evaluation window, without having to save and reopen the check to complete its setup. Editors can create checks that do not require Admin-only Credential or Import Agent selection.

**Why this priority**: The create-with-checks path is the first-run experience. A check that is created without required API authentication can fail from its first scheduled probe even though the user could have configured authentication in the regular editor.

**Independent Test**: As an Admin, create an API-category Component with an authenticated check and an availability target, then verify the check is saved with those settings and is ready to run without a follow-up edit. Repeat for a non-API Component and verify authentication controls are not offered.

**Acceptance Scenarios**:

1. **Given** the new-Component flow for an API-category Component, **When** an Admin configures a supported authentication mode with an existing Credential and submits a valid check, **Then** the check is created with that authentication reference and no secret value is exposed.
2. **Given** the new-Component flow, **When** the user sets an availability target and evaluation window on a check, **Then** both are saved and shown as the check's optional target settings.
3. **Given** the new-Component flow for a non-API Component, **When** the user configures its checks, **Then** API authentication controls are not offered.
4. **Given** invalid check details or a Credential reference the user cannot use, **When** the user submits the new-Component flow, **Then** validation is explained and no partial Component, ComponentInstance, monitoring setup, or checks are created.

---

### User Story 2 - Start checks on an existing Component with no instances (Priority: P2)

An Editor or Admin opens an existing Component that has no ComponentInstances and is given a supported path to save its first instance, then configure URL Checks for it in the regular editor. The flow continues to use that Component rather than asking the user to create a duplicate.

**Why this priority**: Some Components already exist in the catalog without an operational occurrence. The current checks empty state cannot recover that Component, leaving the user unable to monitor it.

**Independent Test**: Open a zero-instance Component, save its first ComponentInstance, configure a URL Check for that instance in the regular editor, and verify the existing Component remains the single catalog record and the check names the new instance.

**Acceptance Scenarios**:

1. **Given** an existing Component with no ComponentInstances, **When** an authorized user opens its URL Checks area, **Then** the page offers a clear action to add the first ComponentInstance and explains that checks attach to an instance.
2. **Given** that Component, **When** the user saves a valid first ComponentInstance, **Then** it is added to the existing Component and the regular URL Check editor becomes available for it.
3. **Given** an invalid instance submission, **When** validation fails, **Then** the user receives actionable errors and no instance is added. **Given** a valid first instance followed by an invalid check submission, **Then** the instance remains and the user can correct or retry check setup without creating another Component.
4. **Given** the first ComponentInstance has been added, **When** the user returns to URL Checks, **Then** the normal check-creation action is available for that instance.

---

### User Story 3 - Understand role requirements before configuring checks (Priority: P2)

An Editor or Admin can tell which check setup actions they are authorized to perform, including when selecting a Credential or an Import Agent requires the Admin role. Users without the required role receive a clear explanation and are not left in a form that can only fail at submission.

**Why this priority**: The create and edit surfaces currently expose different controls and role-gated selectors. Clear, consistent permissions prevent incomplete onboarding and repeated authorization failures without exposing secret values.

**Independent Test**: Exercise the create and edit flows as Viewer, Editor, and Admin users. Verify allowed actions, role explanations for unavailable actions, and backend rejection of unauthorized writes.

**Acceptance Scenarios**:

1. **Given** a Viewer, **When** they open a Component's URL Checks area, **Then** they can read available check information but cannot change checks or monitoring setup.
2. **Given** an Editor or Admin, **When** they open either check-creation flow, **Then** Editors can manage ordinary checks and Hub setup, and Admins can additionally select Credentials and Import Agents.
3. **Given** an Editor reaches a Credential or Import Agent selector, **When** the control is shown, **Then** it explains that Admin access is required and does not expose secret values.
4. **Given** a user who submits a write they are not authorized to perform, **When** the request is rejected, **Then** the error is safe and actionable and no domain state changes.

---

### Edge Cases

- An API check is configured with authentication but no usable Credential reference; validation must prevent an incomplete check from being created.
- An availability target is omitted; the check remains valid and no default target is implied.
- A check endpoint is unreachable during setup; reachability remains the subject of monitoring and does not block saving a valid configuration.
- A Component with no instances is retired or otherwise unavailable for editing; the first-instance action must not bypass the existing lifecycle and authorization rules.
- The user loses permission while the form is open; the write is rejected without a partial create and the user receives a safe explanation.
- An Admin-only selector cannot load its choices; the form must not silently submit a less-configured check than the user intended.

## Requirements

### Functional Requirements

- **FR-001**: The create-with-checks flow MUST support the same URL Check configuration options and validation rules as the regular URL Check editor for fields applicable to the Component and check.
- **FR-002**: For API-category Components, the create-with-checks flow MUST support the authentication modes offered by the regular editor, using existing Credential references rather than accepting or returning secret values.
- **FR-003**: For non-API Components, the create-with-checks flow MUST NOT offer API authentication controls.
- **FR-004**: The create-with-checks flow MUST support an optional availability target and evaluation window for each check. Omitting a target MUST NOT imply a default target.
- **FR-005**: A valid new-Component submission MUST create the Component, its first ComponentInstance, its monitoring setup, and its checks together; an invalid submission MUST leave none of those new records behind.
- **FR-006**: A Component with no ComponentInstances MUST have a user-facing path for an authorized user to save its first instance before configuring URL Checks through the regular editor.
- **FR-007**: The existing-Component recovery path MUST attach the first instance to the selected Component and MUST NOT create a duplicate Component. A valid saved instance MUST remain if a later check-configuration attempt fails.
- **FR-008**: Editors and Admins MUST be able to create and manage ordinary checks and Hub setup; only Admins MUST be able to select Credentials or Import Agents. These role boundaries MUST be enforced by the system.
- **FR-009**: An Editor who cannot select a Credential or Import Agent MUST receive an Admin-role explanation before submission. Secret material MUST remain write-only and MUST NOT be placed in ordinary check configuration, observations, logs, or audit records.
- **FR-010**: The create and edit check flows MUST present consistent permission guidance for creating checks, selecting Credentials, and selecting an Import Agent.
- **FR-011**: Check and ComponentInstance writes MUST preserve existing URL destination safety validation, lifecycle behavior, audit conventions, and separation between check health and ComponentInstance operational status.
- **FR-012**: User-facing and integration documentation MUST describe the updated Component and URL Check onboarding paths and the role requirements for those paths.

### Key Entities

- **Component**: The existing catalog record that may have no ComponentInstances and remains the parent of its instances and checks.
- **ComponentInstance**: The operational occurrence added to the existing Component and targeted by each URL Check.
- **URL Check**: A configured HTTP(S) check with its own authentication reference and optional availability target and evaluation window.
- **Credential**: An existing reusable secret source referenced by an authenticated URL Check; its secret value remains write-only.
- **Import Agent**: An existing remote executor that may be selected as the URL Check execution vantage, subject to its existing access rules.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In the supported create-with-checks flow, 100% of fields needed to configure a valid URL Check that are available in the regular editor can be set before the initial save.
- **SC-002**: An Editor or Admin can take an existing zero-instance Component through adding its first ComponentInstance and configuring a URL Check without creating a second Component.
- **SC-003**: In role-based acceptance tests, 100% of check setup actions either succeed for an authorized role or show the required role before submission; unauthorized writes create no domain-state changes.
- **SC-004**: No secret value is returned or persisted in a URL Check, observation, log, or audit record across the onboarding flows.
- **SC-005**: An invalid new-Component submission creates zero Components, ComponentInstances, monitoring setups, and URL Checks.

## Assumptions

- The regular URL Check editor is the source of truth for supported check fields and their validation.
- Existing URL Check security, execution, lifecycle, and metric semantics remain unchanged; this feature completes onboarding and recovery paths rather than redesigning monitoring.
- No role grants are widened. Editors may manage ordinary checks and Hub setup; Credential and Import Agent selectors remain Admin-only.
- The existing new-Component composite flow remains atomic. For an existing zero-instance Component, the first instance is saved separately before check setup; a valid instance remains if check setup later fails, and no duplicate Component is created.
- Alerting, importer changes, probe behavior changes, and new credential or Import Agent administration capabilities are out of scope.
