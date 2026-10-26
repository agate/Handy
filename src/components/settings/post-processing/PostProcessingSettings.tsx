import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import { Plus, RefreshCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  commands,
  type PostProcessApiFormat,
  type PostProcessProfile,
} from "@/bindings";

import { Alert } from "../../ui/Alert";
import {
  Dialog,
  Dropdown,
  SettingContainer,
  SettingsGroup,
  Textarea,
} from "@/components/ui";
import { Button } from "../../ui/Button";
import { ResetButton } from "../../ui/ResetButton";
import { Input } from "../../ui/Input";

import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import type { ModelOption } from "../PostProcessingSettingsApi/types";
import { ShortcutInput } from "../ShortcutInput";
import { useSettings } from "../../../hooks/useSettings";

const APPLE_PROVIDER_ID = "apple_intelligence";
const APPLE_DEFAULT_MODEL = "Apple Intelligence";

interface ProfileTabsProps {
  profiles: PostProcessProfile[];
  activeId: string | null;
  isAdding: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

const ProfileTabs: React.FC<ProfileTabsProps> = ({
  profiles,
  activeId,
  isAdding,
  onSelect,
  onAdd,
}) => {
  const { t } = useTranslation();
  const addLabel = t("settings.postProcessing.profiles.add");

  return (
    <div
      role="tablist"
      aria-label={t("settings.postProcessing.profiles.tabsLabel")}
      className="flex items-end gap-1 overflow-x-auto border-b border-mid-gray/20"
    >
      {profiles.map((profile) => {
        const selected = profile.id === activeId;
        return (
          <button
            key={profile.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(profile.id)}
            className={`shrink-0 max-w-[180px] truncate rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition-colors cursor-pointer ${
              selected
                ? "border-mid-gray/30 bg-mid-gray/10 font-semibold text-text"
                : "border-transparent text-mid-gray hover:bg-mid-gray/5 hover:text-text"
            }`}
          >
            {profile.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        disabled={isAdding}
        aria-label={addLabel}
        title={addLabel}
        className="mb-0.5 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mid-gray transition-colors hover:bg-logo-primary/20 hover:text-text disabled:opacity-50 cursor-pointer"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
};

interface ProfileEditorProps {
  profile: PostProcessProfile;
  onDeleted: () => void;
}

/** Every setting of one profile. Each field saves on its own when it changes. */
const ProfileEditor: React.FC<ProfileEditorProps> = ({
  profile,
  onDeleted,
}) => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const providers = getSetting("post_process_providers") || [];

  const [name, setName] = useState(profile.name);
  const [prompt, setPrompt] = useState(profile.prompt ?? "");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [appleUnavailable, setAppleUnavailable] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => setName(profile.name), [profile.name]);
  useEffect(() => setPrompt(profile.prompt ?? ""), [profile.prompt]);

  // Saves send the whole profile. Merge each change into the latest version
  // so two quick edits (a key field's blur, then a model pick) can't overwrite
  // each other with a stale copy.
  const latestProfile = useRef(profile);
  useEffect(() => {
    latestProfile.current = profile;
  }, [profile]);

  const isApple = profile.provider_id === APPLE_PROVIDER_ID;
  const isCustom = profile.provider_id === "custom";

  const save = useCallback(
    async (changes: Partial<PostProcessProfile>) => {
      const next = { ...latestProfile.current, ...changes };
      latestProfile.current = next;
      setIsSaving(true);
      try {
        const result = await commands.updatePostProcessProfile(next);
        if (result.status === "error") {
          toast.error(
            t("settings.postProcessing.profiles.errors.save", {
              error: result.error,
            }),
          );
        }
      } finally {
        await refreshSettings();
        setIsSaving(false);
      }
    },
    [refreshSettings, t],
  );

  const fetchModels = useCallback(async () => {
    setIsFetchingModels(true);
    try {
      const result = await commands.fetchPostProcessProfileModels(profile.id);
      if (result.status === "ok") {
        setFetchedModels(result.data);
      } else {
        toast.error(
          t("settings.postProcessing.profiles.errors.fetchModels", {
            error: result.error,
          }),
        );
      }
    } finally {
      setIsFetchingModels(false);
    }
  }, [profile.id, t]);

  const handleProviderSelect = async (providerId: string) => {
    setAppleUnavailable(false);
    if (providerId === profile.provider_id) return;

    if (providerId === APPLE_PROVIDER_ID) {
      const available = await commands.checkAppleIntelligenceAvailable();
      setAppleUnavailable(!available);
    }

    const next = providers.find((provider) => provider.id === providerId);
    setFetchedModels([]);
    // Models and keys belong to the provider they were made for, so never send
    // this profile's key to a different service. A key and model saved for the
    // new provider before tabs existed are picked back up.
    const savedKey = getSetting("post_process_api_keys")?.[providerId] ?? "";
    const savedModel = getSetting("post_process_models")?.[providerId] ?? "";
    await save({
      provider_id: providerId,
      base_url: next?.base_url ?? "",
      api_format: next?.api_format ?? "openai",
      api_key: savedKey,
      model:
        providerId === APPLE_PROVIDER_ID ? APPLE_DEFAULT_MODEL : savedModel,
    });

    // A local endpoint needs no key, so its models can be listed right away
    if (providerId === "custom") {
      void fetchModels();
    }
  };

  const handleNameBlur = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(profile.name);
      return;
    }
    if (trimmed !== profile.name) {
      void save({ name: trimmed });
    }
  };

  const handlePromptBlur = () => {
    if (prompt !== (profile.prompt ?? "")) {
      void save({ prompt });
    }
  };

  const handleDelete = async () => {
    setConfirmingDelete(false);
    const result = await commands.deletePostProcessProfile(profile.id);
    if (result.status === "error") {
      toast.error(
        t("settings.postProcessing.profiles.errors.delete", {
          error: result.error,
        }),
      );
      return;
    }
    await refreshSettings();
    onDeleted();
  };

  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    [providers],
  );

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];
    for (const candidate of [...fetchedModels, profile.model]) {
      const value = candidate?.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      options.push({ value, label: value });
    }
    return options;
  }, [fetchedModels, profile.model]);

  return (
    <div className="space-y-6">
      <SettingsGroup>
        <SettingContainer
          title={t("settings.postProcessing.profiles.name.title")}
          description={t("settings.postProcessing.profiles.name.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameBlur}
            variant="compact"
            className="min-w-[240px]"
          />
        </SettingContainer>
        <ShortcutInput
          shortcutId={profile.id}
          title={t("settings.postProcessing.profiles.shortcut.title")}
          description={t(
            "settings.postProcessing.profiles.shortcut.description",
          )}
          descriptionMode="tooltip"
          grouped={true}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.postProcessing.api.title")}>
        <SettingContainer
          title={t("settings.postProcessing.api.provider.title")}
          description={t("settings.postProcessing.api.provider.description")}
          descriptionMode="tooltip"
          layout="horizontal"
          grouped={true}
        >
          <div className="flex items-center gap-2">
            <ProviderSelect
              options={providerOptions}
              value={profile.provider_id}
              onChange={(value) => void handleProviderSelect(value)}
              disabled={isSaving}
            />
          </div>
        </SettingContainer>

        {isApple && appleUnavailable && (
          <Alert variant="error" contained>
            {t("settings.postProcessing.api.appleIntelligence.unavailable")}
          </Alert>
        )}

        {isCustom && (
          <SettingContainer
            title={t("settings.postProcessing.api.apiFormat.title")}
            description={t("settings.postProcessing.api.apiFormat.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <Dropdown
              options={[
                {
                  value: "openai",
                  label: t(
                    "settings.postProcessing.api.apiFormat.options.openai",
                  ),
                },
                {
                  value: "anthropic",
                  label: t(
                    "settings.postProcessing.api.apiFormat.options.anthropic",
                  ),
                },
              ]}
              selectedValue={profile.api_format ?? "openai"}
              onSelect={(value) => {
                setFetchedModels([]);
                void save({ api_format: value as PostProcessApiFormat });
              }}
              disabled={isSaving}
            />
          </SettingContainer>
        )}

        {isCustom && (
          <SettingContainer
            title={t("settings.postProcessing.api.baseUrl.title")}
            description={t("settings.postProcessing.api.baseUrl.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <BaseUrlField
                value={profile.base_url ?? ""}
                onBlur={(value) => {
                  const trimmed = value.trim();
                  if (trimmed && trimmed !== profile.base_url) {
                    // Another endpoint serves other models; keeping the old
                    // one would make every request fail
                    setFetchedModels([]);
                    void save({ base_url: trimmed, model: "" });
                  }
                }}
                placeholder={
                  profile.api_format === "anthropic"
                    ? t(
                        "settings.postProcessing.api.baseUrl.placeholderAnthropic",
                      )
                    : t("settings.postProcessing.api.baseUrl.placeholder")
                }
                disabled={isSaving}
                className="min-w-[380px]"
              />
            </div>
          </SettingContainer>
        )}

        {!isApple && (
          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("settings.postProcessing.api.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                value={profile.api_key ?? ""}
                onBlur={(value) => {
                  const trimmed = value.trim();
                  if (trimmed !== (profile.api_key ?? "")) {
                    setFetchedModels([]);
                    void save({ api_key: trimmed });
                  }
                }}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={isSaving}
                className="min-w-[320px]"
              />
            </div>
          </SettingContainer>
        )}

        {!isApple && (
          <SettingContainer
            title={t("settings.postProcessing.api.model.title")}
            description={
              isCustom
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
            }
            descriptionMode="tooltip"
            layout="stacked"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <ModelSelect
                value={profile.model ?? ""}
                options={modelOptions}
                disabled={isSaving}
                isLoading={isFetchingModels}
                placeholder={
                  modelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t(
                        "settings.postProcessing.api.model.placeholderNoOptions",
                      )
                }
                onSelect={(value) => void save({ model: value.trim() })}
                onCreate={(value) => void save({ model: value })}
                onBlur={() => {}}
                className="flex-1 min-w-[380px]"
              />
              <ResetButton
                onClick={() => void fetchModels()}
                disabled={isFetchingModels}
                ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
                className="flex h-10 w-10 items-center justify-center"
              >
                <RefreshCcw
                  className={`h-4 w-4 ${isFetchingModels ? "animate-spin" : ""}`}
                />
              </ResetButton>
            </div>
          </SettingContainer>
        )}
      </SettingsGroup>

      <SettingsGroup title={t("settings.postProcessing.prompts.title")}>
        <SettingContainer
          title={t("settings.postProcessing.prompts.promptInstructions")}
          description={t("settings.postProcessing.prompts.description")}
          descriptionMode="tooltip"
          layout="stacked"
          grouped={true}
        >
          <div className="flex flex-col space-y-2">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onBlur={handlePromptBlur}
              placeholder={t(
                "settings.postProcessing.prompts.promptInstructionsPlaceholder",
              )}
              className="min-h-[200px]"
            />
            <p className="text-xs text-mid-gray/70">
              <Trans
                i18nKey="settings.postProcessing.prompts.promptTip"
                components={{ code: <code /> }}
              />
            </p>
          </div>
        </SettingContainer>
      </SettingsGroup>

      <div className="flex justify-end">
        <Button
          variant="danger-ghost"
          size="md"
          onClick={() => setConfirmingDelete(true)}
        >
          <span className="flex items-center gap-1.5">
            <Trash2 className="h-4 w-4" />
            {t("settings.postProcessing.profiles.delete.button")}
          </span>
        </Button>
      </div>

      <Dialog
        open={confirmingDelete}
        title={t("settings.postProcessing.profiles.delete.title", {
          name: profile.name,
        })}
        closeLabel={t("common.close")}
        onOpenChange={setConfirmingDelete}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              {t("settings.postProcessing.profiles.delete.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void handleDelete()}>
              {t("settings.postProcessing.profiles.delete.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-mid-gray">
          {t("settings.postProcessing.profiles.delete.description")}
        </p>
      </Dialog>
    </div>
  );
};

export const PostProcessingSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const profiles = getSetting("post_process_profiles") || [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Fall back to the first tab when nothing (or a deleted tab) is selected
  const activeProfile =
    profiles.find((profile) => profile.id === activeId) ?? profiles[0] ?? null;

  const handleAdd = async () => {
    setIsAdding(true);
    try {
      const result = await commands.addPostProcessProfile(
        t("settings.postProcessing.profiles.newName", {
          number: profiles.length + 1,
        }),
      );
      if (result.status === "error") {
        toast.error(
          t("settings.postProcessing.profiles.errors.add", {
            error: result.error,
          }),
        );
        return;
      }
      await refreshSettings();
      setActiveId(result.data.id);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <ProfileTabs
        profiles={profiles}
        activeId={activeProfile?.id ?? null}
        isAdding={isAdding}
        onSelect={setActiveId}
        onAdd={() => void handleAdd()}
      />

      {activeProfile ? (
        <ProfileEditor
          key={activeProfile.id}
          profile={activeProfile}
          onDeleted={() => setActiveId(null)}
        />
      ) : (
        <div className="rounded-md border border-mid-gray/20 bg-mid-gray/5 p-3">
          <p className="text-sm text-mid-gray">
            {t("settings.postProcessing.profiles.empty")}
          </p>
        </div>
      )}
    </div>
  );
};
