# swr-connector

connectors.ts
```
export const APP_NAME = createAPI({
  origin: process.env.NEXT_PUBLIC_API_URL,
  defaultHeaders: { Accept: "application/json", "Content-Type": "application/json" },
});
```
endpoints/users/calls.ts
```
export const getUsers = APP_NAME.endpoint({
  res: SPLINT.defineType<Pagination<User>>(),
  query: SPLINT.defineType<{ search?: string; pageNumber?: string; pageSize?: string }>(),
  method: "GET",
  url: "/users",
  authorized: true,
});

export const getUser = APP_NAME.endpoint({
  res: SPLINT.defineType<User>(),
  query: SPLINT.defineType<never>(),
  method: "GET",
  url: "/users/:userId",
  authorized: true,
});
```
endpoints/users/hooks.ts
```
export const useUsers = createApiHook(getUsers);
export const useUser = createApiHook(getUser);
```
Usage
```
const {data: users} = useUsers({config: {
// you can put the SWR hook config here
}});

const {data: user} = useUser({params:{userId: query.userId}); // params are typed!
```
