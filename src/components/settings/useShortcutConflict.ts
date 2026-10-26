import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { commands } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";
import { useOsType } from "../../hooks/useOsType";
import { formatKeyCombination } from "../../lib/utils/keyboard";

/**
 * Returns a checker that, before a shortcut is saved, finds another binding
 * already on the same keys and describes the clash in the user's language.
 * The backend enforces the same rule; checking first lets the message name
 * the other shortcut.
 */
export const useShortcutConflict = () => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();
  const osType = useOsType();

  return useCallback(
    async (id: string, shortcut: string): Promise<string | null> => {
      const otherId = await commands.findBindingConflict(id, shortcut);
      if (!otherId) return null;

      const profile = (getSetting("post_process_profiles") || []).find(
        (p) => p.id === otherId,
      );
      const binding = (getSetting("bindings") || {})[otherId];
      const name =
        profile?.name ??
        t(
          `settings.general.shortcut.bindings.${otherId}.name`,
          binding?.name ?? otherId,
        );

      return t("settings.general.shortcut.errors.conflict", {
        shortcut: formatKeyCombination(shortcut, osType),
        name,
      });
    },
    [getSetting, osType, t],
  );
};
