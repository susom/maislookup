<?php

namespace Stanford\MaISlookup;

class Utilities
{
    public static function simplexmlToArray($xml) {
        $array = [];

        // Handle attributes
        foreach ($xml->attributes() as $attrName => $attrValue) {
            $array["@attributes"][$attrName] = (string) $attrValue;
        }

        // Handle children
        foreach ($xml->children() as $child) {
            $childName = $child->getName();
            $value = self::simplexmlToArray($child);

            if (isset($array[$childName])) {
                // Already exists, convert to array
                if (!is_array($array[$childName]) || !isset($array[$childName][0])) {
                    $array[$childName] = [$array[$childName]];
                }
                $array[$childName][] = $value;
            } else {
                $array[$childName] = $value;
            }
        }

        // Handle text content
        $text = trim((string)$xml);
        if (empty($array) && $text !== '') {
            return $text;
        }

        if ($text !== '') {
            $array["#text"] = $text;
        }

        return $array;
    }
}
