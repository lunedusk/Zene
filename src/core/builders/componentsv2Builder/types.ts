import { AttachmentBuilder } from "discord.js";
import { AssetManager, AttachmentInput } from "../helpers/assets.js";

export type Cv2ComponentType = "container" | "text" | "section" | "separator" | "mediaGallery" | "file" | "actionRow" | "button" | "selectMenu";
export type Cv2ButtonStyle  = "primary" | "secondary" | "success" | "danger" | "link";
export type SelectMenuKind  = "string" | "channel" | "user" | "role" | "mentionable";
export type EmojiResolvable = { name?: string; id?: string; animated?: boolean } | string;

export interface BaseSpec { type: Cv2ComponentType; id?: number; }

export interface TextDisplaySpec extends BaseSpec {
    type: "text"; content: string;
    allowedMentions?: { parse?: ("users" | "roles" | "everyone")[]; users?: string[]; roles?: string[]; repliedUser?: boolean; };
}

export interface SeparatorSpec extends BaseSpec { type: "separator"; divider?: boolean; spacing?: "small" | "large"; }
export interface ThumbnailAccessorySpec { url: string; description?: string; spoiler?: boolean; }

export interface ButtonSpec extends BaseSpec {
    type: "button"; label: string; style: Cv2ButtonStyle; customId?: string; payload?: string[]; url?: string; disabled?: boolean; emoji?: EmojiResolvable;
}

export interface StringSelectOptionSpec { label: string; value: string; description?: string; emoji?: EmojiResolvable; default?: boolean; }

export interface BaseSelectMenuSpec extends BaseSpec {
    type: "selectMenu"; customId: string; payload?: string[]; placeholder?: string; minValues?: number; maxValues?: number; disabled?: boolean;
}

export interface StringSelectMenuSpec extends BaseSelectMenuSpec { kind: "string"; options: StringSelectOptionSpec[]; }
export interface ChannelSelectMenuSpec extends BaseSelectMenuSpec { kind: "channel"; channelTypes?: number[]; }
export interface UserSelectMenuSpec extends BaseSelectMenuSpec { kind: "user"; }
export interface RoleSelectMenuSpec extends BaseSelectMenuSpec { kind: "role"; }
export interface MentionableSelectMenuSpec extends BaseSelectMenuSpec { kind: "mentionable"; }

export type SelectMenuSpec = StringSelectMenuSpec | ChannelSelectMenuSpec | UserSelectMenuSpec | RoleSelectMenuSpec | MentionableSelectMenuSpec;
export interface ActionRowSpec extends BaseSpec { type: "actionRow"; components: (ButtonSpec | SelectMenuSpec)[]; }
export interface MediaGalleryItemSpec { url: string; description?: string; spoiler?: boolean; }
export interface MediaGallerySpec extends BaseSpec { type: "mediaGallery"; items: MediaGalleryItemSpec[]; }
export interface FileSpec extends BaseSpec { type: "file"; url: string; spoiler?: boolean; }
export interface SectionSpec extends BaseSpec {
    type: "section"; texts: TextDisplaySpec[];
    accessory: { kind: "thumbnail"; data: ThumbnailAccessorySpec } | { kind: "button"; data: ButtonSpec };
}
export interface ContainerSpec extends BaseSpec { type: "container"; accentColor?: number | string; spoiler?: boolean; children: ComponentSpec[]; }

export type ComponentSpec = TextDisplaySpec | SeparatorSpec | SectionSpec | MediaGallerySpec | FileSpec | ActionRowSpec | ContainerSpec | ButtonSpec | SelectMenuSpec;

export interface LayoutSpec { version: 1; components: ComponentSpec[]; }

export interface BuildContext { 
    assetManager?: AssetManager; 
    attachments?: Record<string, AttachmentInput>;
    variables?: Record<string, any>; 
    disableAll?: boolean; 
}
export interface BuildOptions { autoWrapInteractives?: boolean; }
export interface BuildResult { components: any[]; files: AttachmentBuilder[]; flags: number; }