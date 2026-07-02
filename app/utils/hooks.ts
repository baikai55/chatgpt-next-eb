import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    const customProviderModels = (accessStore.customProviders ?? [])
      .flatMap((provider) => {
        // models may be corrupted (non-array) from older imports, guard it
        const models = Array.isArray(provider.models)
          ? provider.models
          : Object.values(provider.models ?? {});
        return models
          .map((model) => String(model).trim())
          .filter((model) => model.length > 0)
          .map((model) => `${model}@${provider.name}`);
      })
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
