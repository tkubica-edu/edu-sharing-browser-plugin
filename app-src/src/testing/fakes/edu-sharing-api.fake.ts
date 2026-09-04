import { Observable, Subject, of, throwError } from 'rxjs';
import {
  AuthenticationService,
  ClientConfig,
  ClientutilsV1Service,
  CollectionService,
  ConfigService,
  Connector,
  ConnectorList,
  ConnectorService,
  CurrentUserInfo,
  EduSharingApiConfiguration,
  LoginInfo,
  Node,
  NodeService,
  NodeServiceUnwrapped,
  UserEntry,
  UserService,
  Variables,
  WebsiteInformation,
} from 'ngx-edu-sharing-api';
import { vi } from 'vitest';

/**
 * Fakes for the `ngx-edu-sharing-api` services the tested code injects. They stand in for the whole
 * repository: nothing in a unit test builds a request, so nothing depends on a repository being up.
 *
 * `provideHttpClientTesting` (see `../test-providers.ts`) is the second line — these fakes are what
 * makes a spec able to *state* what the repository answers, the testing backend is what catches a
 * request that reaches HTTP anyway.
 */

/** A login info the panel reads as a valid session of a real user. */
export function aLoginInfo(overrides: Partial<LoginInfo> = {}): LoginInfo {
  return {
    isValidLogin: true,
    isGuest: false,
    isAdmin: false,
    authorityName: 'test-user',
    sessionTimeout: 3600,
    ...overrides,
  } as LoginInfo;
}

/** `AuthenticationService` answering with whatever login info the spec puts in. */
export function fakeAuthentication(info: LoginInfo = aLoginInfo()) {
  /** What every observer of the login state is answered with; a spec swaps it per case. */
  let loginInfo: Observable<LoginInfo> = of(info);

  /**
   * What the bearer-token login answers with, where a spec wants it to differ from the rest — the
   * repository can refuse an OAuth token it does not know while a password login would have worked.
   * Unset, it answers like every other login action does.
   */
  let tokenLogin: Observable<LoginInfo> | null = null;

  /** The backend ending the session on its own, and the countdown to it — see `observeAutoLogout`. */
  const autoLogout = new Subject<void>();
  const timeUntilAutoLogout = new Subject<number | null>();

  const fake = {
    observeLoginInfo: vi.fn(() => loginInfo),
    forceLoginInfoRefresh: vi.fn(),
    login: vi.fn((_username: string, _password: string, _scope?: string) => loginInfo),
    loginToken: vi.fn((_accessToken: string) => tokenLogin ?? loginInfo),
    logout: vi.fn(() => of(aLoginInfo({ isValidLogin: false, isGuest: true }))),
    observeAutoLogout: vi.fn(() => autoLogout.asObservable()),
    observeTimeUntilAutoLogout: vi.fn((_interval: number) => timeUntilAutoLogout.asObservable()),
  } satisfies Partial<AuthenticationService>;

  /** The repository answers with this login info from now on. */
  function answers(next: LoginInfo): void {
    loginInfo = of(next);
  }

  /** It answers a bearer token with this, whatever it answers the other login actions with. */
  function answersToken(next: LoginInfo): void {
    tokenLogin = of(next);
  }

  /** It refuses the bearer token — the OAuth login completed, the repository still says no. */
  function refusesToken(cause: unknown): void {
    tokenLogin = throwError(() => cause);
  }

  /** The repository cannot be reached, or refuses — every observer sees this error. */
  function fails(cause: unknown): void {
    loginInfo = throwError(() => cause);
  }

  /** The repository never answers, which is what the service's timeout is there for. */
  function silent(): void {
    loginInfo = new Observable<LoginInfo>();
  }

  /** The repository logged the session out because nothing was asked of it for too long. */
  function timesOut(): void {
    autoLogout.next();
  }

  /** The countdown to that, as the library reports it — null once there is no session. */
  function reportsTimeUntilLogout(remaining: number | null): void {
    timeUntilAutoLogout.next(remaining);
  }

  /** The repository refuses the logout call, or cannot be reached for it. */
  function failsLogout(cause: unknown): void {
    fake.logout.mockReturnValue(throwError(() => cause));
  }

  return {
    fake,
    answers,
    answersToken,
    refusesToken,
    fails,
    silent,
    timesOut,
    reportsTimeUntilLogout,
    failsLogout,
  };
}

export type AuthenticationFake = ReturnType<typeof fakeAuthentication>;

/** `UserService` answering with the person behind the session, or refusing to. */
export function fakeUserApi(entry: UserEntry | null = null) {
  let currentUser: Observable<UserEntry | null> = of(entry);

  /**
   * The person plus the login info, as `observeCurrentUserInfo` answers. What the logout reads the
   * user's authentication type off (`cm:esssotype`), which decides which logout address applies.
   */
  let currentUserInfo: Observable<CurrentUserInfo> = of({
    user: entry,
    loginInfo: aLoginInfo(),
  } as CurrentUserInfo);

  /** The profile preferences, where the default filing folder lives. Empty for a session without one. */
  let preferences: Observable<unknown> = of({});

  const fake = {
    observeCurrentUser: vi.fn(() => currentUser),
    observeCurrentUserInfo: vi.fn(() => currentUserInfo),
    getUserPreferences: vi.fn(() => preferences),
  } satisfies Partial<UserService>;

  /** The profile carries these preferences. */
  function prefers(next: Record<string, unknown>): void {
    preferences = of(next);
  }

  /** There is no profile to read them from — a guest session, or a repository that refuses. */
  function hasNoPreferences(cause: unknown = new Error('no profile')): void {
    preferences = throwError(() => cause);
  }

  function answers(next: UserEntry | null): void {
    currentUser = of(next);
    currentUserInfo = of({ user: next, loginInfo: aLoginInfo() } as CurrentUserInfo);
  }

  /** The signed-in user is authenticated the given way — `null` for a user the repository holds. */
  function isAuthenticatedBy(ssoType: string | null): void {
    const person = { properties: ssoType ? { 'cm:esssotype': [ssoType] } : {} };
    currentUserInfo = of({ user: { person }, loginInfo: aLoginInfo() } as unknown as CurrentUserInfo);
  }

  function fails(cause: unknown): void {
    currentUser = throwError(() => cause);
    currentUserInfo = throwError(() => cause);
  }

  return { fake, answers, isAuthenticatedBy, fails, prefers, hasNoPreferences };
}

export type UserApiFake = ReturnType<typeof fakeUserApi>;

/** A node as the repository answers with one. */
export function aNode(overrides: Partial<Node> = {}): Node {
  return {
    ref: { id: '2c4d6b1a-8f3e-4c2b-9a10-7d5e6f8b0c31', repo: 'local' },
    name: 'optik.html',
    type: 'ccm:io',
    mimetype: 'text/html',
    properties: {},
    aspects: [],
    access: [],
    ...overrides,
  } as unknown as Node;
}

/**
 * `NodeService` — the wrapper the panel writes metadata and content through. Every call answers with the
 * node the spec put in and records what it was asked, so an assertion is about the call rather than about
 * a URL. {@link refuses} is what makes a write fail, which is the branch the retries are written for.
 */
export function fakeNodeApi(node: Node = aNode()) {
  /** Which calls are to fail, by method name — see {@link refuses}. */
  const refusing = new Map<string, unknown>();

  /** Properties a single-property write is to refuse, for the field-by-field retry. */
  const refusedProperties = new Set<string>();

  const answer = (method: string, value: Node = node): Observable<Node> =>
    refusing.has(method) ? throwError(() => refusing.get(method)) : of(value);

  const fake = {
    getNode: vi.fn((_nodeId: string) => answer('getNode')),
    getParents: vi.fn((_nodeId: string) =>
      refusing.has('getParents')
        ? throwError(() => refusing.get('getParents'))
        : of({ nodes: parents, pagination: { total: parents.length, from: 0, count: parents.length } }),
    ),
    editNodeMetadata: vi.fn((_nodeId: string, properties: Record<string, string[]>, _options?: unknown) => {
      const refused = Object.keys(properties).find((name) => refusedProperties.has(name));
      if (refused) return throwError(() => new Error(`property refused: ${refused}`));
      return answer('editNodeMetadata');
    }),
    createChild: vi.fn((_request: unknown) => answer('createChild')),
    changeContent: vi.fn(
      (_repository: string, _node: string, _mimetype: string, _comment: string, _body: unknown) =>
        answer('changeContent'),
    ),
  } satisfies Partial<NodeService>;

  /** What `getParents` answers with — the node's place in the repository, closest first. */
  let parents: Node[] = [];

  /** The repository answers this call with a failure. */
  function refuses(method: keyof typeof fake, cause: unknown = new Error('refused')): void {
    refusing.set(method, cause);
  }

  /** It refuses a metadata write naming this property, whatever else the write carries. */
  function refusesProperty(name: string): void {
    refusedProperties.add(name);
  }

  /** The node sits in these folders, closest first. */
  function sitsIn(nodes: Node[]): void {
    parents = nodes;
  }

  return { fake, refuses, refusesProperty, sitsIn };
}

export type NodeApiFake = ReturnType<typeof fakeNodeApi>;

/**
 * `NodeServiceUnwrapped` — the generated API, for the four calls the wrapper does not cover: creating a
 * child, replacing a preview, recording a workflow step and moving a node.
 */
export function fakeNodeApiUnwrapped(node: Node = aNode()) {
  const refusing = new Map<string, unknown>();

  const answer = <T>(method: string, value: T): Observable<T> =>
    refusing.has(method) ? throwError(() => refusing.get(method)) : of(value);

  const fake = {
    createChild: vi.fn((_request: unknown) => answer('createChild', { node })),
    changePreview: vi.fn((_request: unknown) => answer('changePreview', { node })),
    addWorkflowHistory: vi.fn((_request: unknown) => answer('addWorkflowHistory', { node })),
    createChildByMoving: vi.fn((_request: unknown) => answer('createChildByMoving', { node })),
  } satisfies Partial<NodeServiceUnwrapped>;

  function refuses(method: keyof typeof fake, cause: unknown = new Error('refused')): void {
    refusing.set(method, cause);
  }

  return { fake, refuses };
}

export type NodeApiUnwrappedFake = ReturnType<typeof fakeNodeApiUnwrapped>;

/** `ConnectorService`, whose list decides whether a node is opened in a connector or merely downloaded. */
export function fakeConnectors(list: ConnectorList = {} as ConnectorList) {
  let answer: Observable<ConnectorList> = of(list);

  const fake = {
    observeConnectorList: vi.fn(() => answer),
  } satisfies Partial<ConnectorService>;

  /** The repository offers these connectors. */
  function offers(connectors: Partial<Connector>[], simple: Partial<Connector>[] = []): void {
    answer = of({ connectors, simpleConnectors: simple } as ConnectorList);
  }

  /** The list cannot be read — which must not be read as "the node opens nowhere". */
  function fails(cause: unknown = new Error('no connectors')): void {
    answer = throwError(() => cause);
  }

  return { fake, offers, fails };
}

export type ConnectorsFake = ReturnType<typeof fakeConnectors>;

/** `EduSharingApiConfiguration`, whose `rootUrl` every address the panel composes is derived from. */
export function fakeApiConfiguration(rootUrl = 'https://repo.example.org/edu-sharing/rest') {
  return {
    fake: { rootUrl } satisfies Partial<EduSharingApiConfiguration>,
  };
}

/**
 * `ClientutilsV1Service`, whose `getWebsiteInformation` is the repository's answer to „is this page
 * already in here". The spy is what a spec asserts *was not called* — most of
 * `PageRecognitionService` is about not asking.
 */
export function fakeClientUtils(information: WebsiteInformation = {}) {
  let answer: Observable<WebsiteInformation> = of(information);

  const fake = {
    getWebsiteInformation: vi.fn(() => answer),
  } satisfies Partial<ClientutilsV1Service>;

  function answers(next: WebsiteInformation): void {
    answer = of(next);
  }

  function fails(cause: unknown): void {
    answer = throwError(() => cause);
  }

  return { fake, answers, fails };
}

export type ClientUtilsFake = ReturnType<typeof fakeClientUtils>;

/**
 * `ConfigService`, whose client config carries the repository's logout policy (`logout`) — what
 * LogoutService branches on. Answers with no config at all by default, which is the ordinary case:
 * a repository that publishes no policy is logged out of by ending the session.
 */
export function fakeConfig(config: ClientConfig | null = null) {
  let answer: Observable<ClientConfig | null> = of(config);

  /**
   * The repository's config variables — where `browserExtensionEditorialGroups` and friends live. The
   * library types every value as a string; what actually arrives is whatever the repository wrote, so a
   * spec states it as such and this hands it over the way the caller reads it.
   */
  let variables: Observable<Variables | null> = of({} as Variables);

  const fake = {
    observeConfig: vi.fn(() => answer),
    observeVariables: vi.fn(() => variables),
  } satisfies Partial<ConfigService>;

  /** The repository publishes these config variables. */
  function answersVariables(next: Record<string, unknown>): void {
    variables = of(next as Variables);
  }

  /** It does not answer the variables at all — which is not the same as naming none. */
  function failsVariables(cause: unknown = new Error('config unreachable')): void {
    variables = throwError(() => cause);
  }

  function answers(next: ClientConfig | null): void {
    answer = of(next);
  }

  /** The repository publishes this logout policy and nothing else of interest. */
  function answersLogout(logout: NonNullable<ClientConfig['logout']>): void {
    answer = of({ logout } as ClientConfig);
  }

  function fails(cause: unknown): void {
    answer = throwError(() => cause);
  }

  return { fake, answers, answersLogout, fails, answersVariables, failsVariables };
}

export type ConfigFake = ReturnType<typeof fakeConfig>;

/**
 * `CollectionService` — the collections an editorial group is, and the collections inside it. Answers
 * with nothing by default: a repository whose groups are configured but not readable is the case the
 * loading is written to survive.
 */
export function fakeCollections() {
  const held = new Map<string, Node>();
  const children = new Map<string, Node[]>();
  const refusing = new Set<string>();

  const fake = {
    getCollection: vi.fn((id: string) =>
      refusing.has(id) || !held.has(id)
        ? throwError(() => new Error(`no collection ${id}`))
        : of(held.get(id) as Node),
    ),
    getSubCollections: vi.fn((id: string) =>
      refusing.has(`${id}/children`)
        ? throwError(() => new Error(`no children of ${id}`))
        : of(children.get(id) ?? []),
    ),
  } satisfies Partial<CollectionService>;

  /** The repository holds this collection, with these collections inside it. */
  function holds(node: Node, inside: Node[] = []): void {
    held.set(node.ref.id, node);
    children.set(node.ref.id, inside);
  }

  /** It will not hand this collection back — one that is gone, or one this session may not see. */
  function refuses(id: string): void {
    refusing.add(id);
  }

  /** It hands the collection back but not what is inside it. */
  function refusesChildren(id: string): void {
    refusing.add(`${id}/children`);
  }

  return { fake, holds, refuses, refusesChildren };
}

export type CollectionsFake = ReturnType<typeof fakeCollections>;
