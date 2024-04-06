import { EventListEntry } from "@/components/interactionFeedback/events/toastList";
import { toast } from "@/components/toaster/toast";
import { Session } from "@/utils/cookieHandlers/SessionHandler";
import { Translate } from "next-translate";
import getT from "next-translate/getT";
import { Assign } from "utility-types";
import { ApiError } from "./ApiError";
import { FeedbackEvent } from "@/components/toaster/ToastController";
import debugLog from "@/utils/debugLog";

interface QueryParams {
  [x: string]: string;
}
// Types copied from react-router under MIT license
// Copyright (c) React Training 2015-2019 Copyright (c) Remix Software 2020-2022
// <>
type PathParams<Path extends string> =
  /**
   * Check whether provided argument is valid route string with parameters
   */
  Path extends `:${infer Param}/${infer Rest}`
    ? /**
       * If yes, call PathParams recursively with rest part of the string
       * and make it union with current param
       */
      Param | PathParams<Rest>
    : /**
     * Otherwise, check if argument is standalone parameter, for instance ":userId"
     */
    Path extends `:${infer Param}`
    ? /**
       * If yes, return it
       */
      Param
    : /**
     * Otherwise check if provided string is allowed route string
     * but without /, for instance "user:userId"
     */
    Path extends `${infer _Prefix}:${infer Rest}`
    ? /**
       * If yes, call recursively PathParams with this parameter
       */
      PathParams<`:${Rest}`>
    : /**
       * If provided string is invalid - return never
       */
      never;

/**
 * Convert union to record with appropriate keys
 */
type PathArgs<Path extends string> = { [K in PathParams<Path>]: string };
// </>

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ConnectorSettings {
  origin: string;
  defaultHeaders?: Record<string, string>;
}
type EndpointSettings<
  T = string,
  Data = unknown,
  Error = ApiError<unknown>,
  Payload = unknown,
  Query = QueryParams,
> = {
  url: T;
  res: Data;
  query?: Query;
  error?: Error;
  origin?: string;
  headers?: Record<string, string>;
  payload?: Payload;
  authorized: boolean;
  token?: string;
} & (
  | {
      // make toast necessary for those methods
      method: Extract<Method, "POST" | "PATCH" | "PUT" | "DELETE">;
      toast: EventListEntry | null;
    }
  | {
      // make toast optional for those methods
      method: Extract<Method, "GET">;
      toast?: EventListEntry | null;
    }
);

interface CallSettings<T = string, Payload = unknown> {
  url?: T;
  method?: Method;
  origin?: string;
  headers?: Record<string, string>;
  payload?: Payload;
  authorized?: boolean;
  token?: string;
  toast?: EventListEntry | null;
}

function createUrl(url: string, params: Record<string, string> | undefined = {}) {
  const splitted = url.split("/");
  const res = splitted.map((el) => {
    if (el.charAt(0) === ":") {
      const paramName = el.split("").slice(1).join("");
      // if (!params[paramName]) {
      //   throw new Error(`Missing parameter ${paramName} in url ${url}`);
      // }
      return params[paramName];
    }
    return el;
  });
  return res.join("/");
}

export const createAPI = (globalSettings: ConnectorSettings) => {
  return {
    // the only purpose of this function is to pass the generic type. It can't
    // be placed in the main function because in TS 5.0 it's still impossible to have both
    // custom generic type and inferred one; passing a custom generic will break the inference.
    // https://github.com/microsoft/TypeScript/issues/26242
    defineType: function <T>(): T {
      return null as unknown as T;
    },
    endpoint: function createApiEndpoint<
      Data,
      Error,
      Payload,
      Query = QueryParams,
      Url extends string = any,
    >(settings: EndpointSettings<Url, Data, Error, Payload, Query>) {
      return function handleApiCall<
        T extends Omit<CallSettings<Url, Payload>, "url" | "scope"> & {
          lang?: string;
          query?: Query;
        },
      >(
        innerSettings: PathParams<Url> extends never
          ? Assign<T, {}>
          : Assign<{ params: PathArgs<Url> }, T>,
      ): {
        invoke: () => Promise<
          | {
              ok: true;
              data: Data;
              error: undefined;
              status: number;
            }
          | {
              ok: false;
              data: undefined;
              error: Error | undefined;
              status: number;
            }
        >;
        keys: string[];
        fetcher: () => Promise<Data | undefined>;
      } {
        const settingsPutTogether = {
          params: {},
          ...settings,
          ...innerSettings,
          origin: innerSettings?.origin || settings.origin || globalSettings.origin,
          headers: {
            ...(globalSettings.defaultHeaders ?? {}),
            ...(settings.headers ?? {}),
            ...(innerSettings?.headers ?? {}),
          },
        };

        const token = settingsPutTogether.token
          ? `bearer ${settingsPutTogether.token}`
          : getToken(settingsPutTogether.authorized);
        const url = createUrl(settingsPutTogether.url, settingsPutTogether?.params);

        const searchParams = (() => {
          const urlSearchParams = new URLSearchParams();
          Object.entries(settingsPutTogether?.query ?? {}).forEach(([key, val]) => {
            if (Array.isArray(val)) {
              val.forEach((v) => {
                urlSearchParams.append(key, v);
              });
            } else {
              urlSearchParams.append(key, val as string);
            }
          });

          return urlSearchParams;
        })();
        const searchString = searchParams.toString();
        const search = searchString ? `?${searchString}` : "";
        settingsPutTogether.url = (url + search) as Url;

        const lang = (() => {
          if (settingsPutTogether?.lang) {
            return settingsPutTogether?.lang;
          }
          if (typeof document === "object") {
            return document.documentElement.lang;
          }

          return "";
        })();

        return {
          invoke: () => {
            return apiCall<Data, Error>(settingsPutTogether, token, lang);
          },
          /**
           * Note: is is VERY important not to have any "undefined" in the key list! Make sure to never put any.
           */
          keys: [settingsPutTogether.origin + settingsPutTogether.url, token ?? ""],
          fetcher: async () => {
            const { ok, error, data, status } = await apiCall<Data, Error>(
              settingsPutTogether,
              token,
              lang,
            );
            if (ok) {
              return data;
            }
            throw new ApiError("An error occurred while fetching the data.", status, error);
          },
        };
      };
    },
  };
};

interface ApiCallSettings extends CallSettings {
  origin: string;
}

function getToken(authorized: CallSettings["authorized"]) {
  if (!authorized) return undefined;

  return Session.getToken();
}

const translateByLang: Record<string, Translate> = {};

/**
 *
 * @returns react-translate "t" function
 * Fetches the "t" function if it's the first invocation of the toast. Otherwise, takes if from the "cache".
 */
async function getOrFetchT(lang: string) {
  if (lang in translateByLang) return translateByLang[lang];

  const t = await getT(lang, "notifications");
  translateByLang[lang] = t;

  return t;
}

const apiCall = async <T, U>(
  settings: ApiCallSettings,
  token: string | undefined,
  lang: string,
) => {
  const allHeaders = { ...settings.headers };
  Object.entries(allHeaders).forEach(([key, value]) => {
    if (value === undefined) {
      delete allHeaders[key];
    }
  });
  // We don't want to have any content-type header for FormData payload, because
  // the browser has to define the boundary by itself and add proper heading automatically.
  if (settings.payload instanceof FormData) {
    allHeaders.Accept = "multipart/form-data";
    delete allHeaders["Content-Type"];
  }
  if (token) {
    allHeaders.Authorization = token;
  }
  if (lang) {
    allHeaders["Content-Language"] = lang;
  }

  try {
    const res = await fetch(settings.origin + settings.url, {
      method: settings.method,
      body: settings.payload
        ? settings.payload instanceof FormData
          ? settings.payload
          : JSON.stringify(settings.payload)
        : null,
      headers: new Headers(allHeaders),
    });
    debugLog({
      origin: settings.origin,
      url: settings.url,
      status: res.status,
      method: settings.method,
    });

    if (settings.toast) {
      const t = await getOrFetchT(lang);

      const statusError = settings.toast.handleCodes?.find((el) => el.code === res.status);

      function handleStatusErrorToast(event: FeedbackEvent | null) {
        if (event) {
          toast({ message: t(event.message), type: event.type });
        }
      }

      if (statusError) {
        handleStatusErrorToast(statusError.event);
      } else {
        if (res.ok && settings.toast.success) {
          toast({ message: t(settings.toast.success.message), type: settings.toast.success.type });
        }
        if (!res.ok && settings.toast.error) {
          toast({ message: t(settings.toast.error.message), type: settings.toast.error.type });
        }
      }
    }
    const contentType = res.headers.get("content-type") ?? "";

    if (res.headers.get("content-length") === "0" || !contentType) {
      if (res.ok) {
        return { ok: true, data: undefined as T, error: undefined, status: res.status } as const;
      } else {
        return {
          ok: false,
          data: undefined,
          error: new ApiError("error", res.status) as U,
          status: res.status,
        } as const;
      }
    }
    // handle json type:
    if (contentType.includes("application/json")) {
      const payload = await res.json();
      if (res.ok) {
        return {
          ok: true,
          data: payload as T,
          error: undefined,
          status: res.status,
        } as const;
      } else {
        return {
          ok: false,
          data: undefined,
          error: payload as U,
          status: res.status,
        } as const;
      }
      // handle files that can be parsed to a blob:
    } else if (
      [
        // add more mimetypes if needed
        "application/pdf",
        "text/csv",
      ].includes(contentType)
    ) {
      const payload = await res.blob();

      if (res.ok) {
        return {
          ok: true,
          data: payload as T,
          error: undefined,
          status: res.status,
        } as const;
      } else {
        return {
          ok: false,
          data: undefined,
          error: payload as U,
          status: res.status,
        } as const;
      }
    } else {
      console.error(
        `Unhandled content type ${contentType}. Please add it to the mimetype list in the API connector.`,
      );
      return { ok: res.ok, data: undefined, error: undefined, status: res.status } as {
        ok: true;
        data: T;
        error: undefined;
        status: number;
      };
    }
  } catch (err) {
    console.info(
      `An API connector error occurred. It usually happens when the response headers don't match the actual content (e.g. the content-type header is application/json, but there's no content at all or the content is html). METHOD: ${settings.method}, URL: ${settings.url}`,
    );
    console.error(err);
    return { ok: false, data: undefined, error: undefined, status: 500 } as const;
  }
};
