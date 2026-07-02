import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    const customProviderModels = (accessStore.customProviders ?? [])
      .flatMap((provider) =>
        provider.models
          .map((model) => model.trim())
          .filter((model) => model.length > 0)
          .map((model) => `${model}@${provider.name}`),
      )
      .join(",");

    return collectModelsWithDefaultModel(
      configStore.models,
      [
        configStore.customModels,
        accessStore.customModels,
        customProviderModels,
      ].join(","),
      accessStore.defaultModel,
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    accessStore.customProviders,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}
