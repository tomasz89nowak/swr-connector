import { usePage } from "@/components/GlobalStateWrapper";
import { useEffect, useRef } from "react";
import useSWR, { SWRConfiguration } from "swr";
import { InferArgsType, PromiseThen } from "typeUtils";
import { Assign } from "utility-types";
import { ApiError } from "./ApiError";

export interface Config<Data> {
  config?: SWRConfiguration<Data>;
  /**
   * https://swr.vercel.app/docs/revalidation#disable-automatic-revalidations
   */
  immutable?: boolean;
  handlePageError?: boolean;
}

export function createApiHook<
  T extends (...args: any) => any,
  Data extends NonNullable<PromiseThen<ReturnType<ReturnType<T>["fetcher"]>>>,
>(func: T) {
  return (
    arg: InferArgsType<T>[0]["params"] extends {}
      ? Assign<InferArgsType<T>[0], Config<Data>>
      : void | (InferArgsType<T>[0] & Config<Data>),
  ) => {
    const connector = func(arg);
    const immutabilityProps = arg?.immutable
      ? { revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false }
      : {};

    const swrConfig = {
      ...immutabilityProps,
      ...(arg?.config ?? {}),
      // We don't want to provide the "isPaused" method to the SWR config because it's bugged as hell and it's blocking the data refresh even if the method returns false (but previously returned true). May be related to this issue: https://github.com/vercel/swr/issues/2333
      // How to test if it finally works:
      // - Remove the "isPaused" override below and:
      // - go to the profile page,
      // - open the school modal,
      // - change the city,
      // - change the school,
      // - if data of the new school was fetched - it works.
    };
    const { setPageError } = usePage();

    const isMounted = useRef(true);
    useEffect(() => {
      // TODO  enable when it will not break all the tests
      isMounted.current = true;

      return () => {
        isMounted.current = false;
      };
    }, []);

    return useSWR<Data, ApiError>(
      swrConfig.isPaused && swrConfig.isPaused() ? null : connector.keys,
      connector.fetcher,
      {
        ...swrConfig,
        onError(err, key, config) {
          swrConfig.onError?.(err, key, config);
          if (arg && arg.handlePageError !== false && isMounted.current) {
            setPageError(err);
          }
        },
        isPaused: () => false,
      },
    );
  };
}
